import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateTaxDeclarationDto, ValidateTaxDeclarationDto, TaxType,
} from './dto/tax.dto';

interface AccountBalance {
  account_code: string;
  account_label: string;
  debit_total: number;
  credit_total: number;
  solde: number;
}

@Injectable()
export class TaxService {
  private readonly logger = new Logger(TaxService.name);

  constructor(private prisma: PrismaService) {}

  // ── Lister les déclarations ───────────────────────────────
  async findAll(companyId: string) {
    return this.prisma.taxDeclaration.findMany({
      where: { company_id: companyId },
      include: { fiscal_year: { select: { label: true } } },
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Calculer et créer une déclaration ────────────────────
  async create(companyId: string, dto: CreateTaxDeclarationDto) {
    const [company, fiscalYear] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.fiscalYear.findFirst({ where: { id: dto.fiscal_year_id, company_id: companyId } }),
    ]);
    if (!fiscalYear) throw new NotFoundException('Exercice introuvable');

    const computed = await this.computeDeclaration(
      companyId,
      company.accounting_system,
      dto.tax_type as any,
      new Date(dto.period_start),
      new Date(dto.period_end),
    );

    return this.prisma.taxDeclaration.create({
      data: {
        company_id:     companyId,
        fiscal_year_id: dto.fiscal_year_id,
        tax_type:       dto.tax_type as any,
        period_start:   new Date(dto.period_start),
        period_end:     new Date(dto.period_end),
        status:         'calculee',
        computed_data:  computed.data,
        tax_base:       computed.tax_base,
        tax_amount:     computed.tax_amount,
      },
    });
  }

  // ── Générer la DSF complète ───────────────────────────────
  async generateDsf(companyId: string, fiscalYearId: string) {
    const [company, fiscalYear] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.fiscalYear.findFirst({
        where: { id: fiscalYearId, company_id: companyId },
      }),
    ]);
    if (!fiscalYear) throw new NotFoundException('Exercice introuvable');

    const balances = await this.getAccountBalances(
      companyId, fiscalYearId, fiscalYear.start_date, fiscalYear.end_date,
    );
    const mappings = await this.prisma.dsfMapping.findMany({
      where: { accounting_system: company.accounting_system },
    });
    const assets = await this.prisma.fixedAsset.findMany({
      where: { company_id: companyId, is_active: true },
      include: { depreciation_lines: { where: { fiscal_year_id: fiscalYearId } } },
    });

    const dsf = this.buildDsfData(balances, mappings, assets, company, fiscalYear);

    // Vérification bilan équilibré
    const actif  = dsf.bilan_actif.total;
    const passif = dsf.bilan_passif.total;
    const ecart  = Math.abs(actif - passif);
    const controles = {
      bilan_equilibre:  ecart < 1,
      ecart_bilan:      ecart,
      coherence_resultat: Math.abs(
        (dsf.resultat.total_produits - dsf.resultat.total_charges) - dsf.bilan_passif.resultat_exercice,
      ) < 1,
    };

    return {
      company:     { name: company.name, country: company.country },
      fiscal_year: { label: fiscalYear.label, start: fiscalYear.start_date, end: fiscalYear.end_date },
      ...dsf,
      controles,
    };
  }

  // ── Valider une déclaration ───────────────────────────────
  async validate(companyId: string, id: string, userId: string, dto: ValidateTaxDeclarationDto) {
    const decl = await this.prisma.taxDeclaration.findFirst({
      where: { id, company_id: companyId },
    });
    if (!decl) throw new NotFoundException('Déclaration introuvable');
    return this.prisma.taxDeclaration.update({
      where: { id },
      data: {
        status:       'validee',
        validated_by: userId,
        validated_at: new Date(),
      },
    });
  }

  // ── Marquer comme déposée ─────────────────────────────────
  async markSubmitted(companyId: string, id: string) {
    const decl = await this.prisma.taxDeclaration.findFirst({
      where: { id, company_id: companyId },
    });
    if (!decl) throw new NotFoundException('Déclaration introuvable');
    return this.prisma.taxDeclaration.update({
      where: { id },
      data: { status: 'deposee', submitted_at: new Date() },
    });
  }

  // ── Calcul TVA ────────────────────────────────────────────
  private async computeDeclaration(
    companyId: string,
    system: string,
    taxType: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const balances = await this.getAccountBalancesInPeriod(companyId, periodStart, periodEnd);

    if (taxType === 'tva_collectee' || taxType === 'tva_deductible') {
      const tvaCollectee = balances
        .filter(b => b.account_code.startsWith('4457'))
        .reduce((sum, b) => sum + b.credit_total, 0);
      const tvaDeductible = balances
        .filter(b => b.account_code.startsWith('4456'))
        .reduce((sum, b) => sum + b.debit_total, 0);
      const tvaDue = tvaCollectee - tvaDeductible;
      return {
        tax_base:  tvaCollectee / 0.2,
        tax_amount: Math.max(tvaDue, 0),
        data: { tva_collectee: tvaCollectee, tva_deductible: tvaDeductible, tva_due: tvaDue },
      };
    }

    if (taxType === 'is') {
      const produits = balances.filter(b => b.account_code.startsWith('7')).reduce((s, b) => s + b.credit_total, 0);
      const charges  = balances.filter(b => b.account_code.startsWith('6')).reduce((s, b) => s + b.debit_total, 0);
      const benefice = produits - charges;
      const tauxIs   = system === 'ohada' ? 0.30 : 0.25;
      const isAmount = Math.max(benefice * tauxIs, 0);
      return {
        tax_base:  benefice,
        tax_amount: isAmount,
        data: { produits, charges, benefice, taux_is: tauxIs, is_theorique: isAmount },
      };
    }

    return { tax_base: 0, tax_amount: 0, data: {} };
  }

  // ── Soldes par compte ─────────────────────────────────────
  private async getAccountBalances(
    companyId: string,
    fiscalYearId: string,
    start: Date,
    end: Date,
  ): Promise<AccountBalance[]> {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        company_id: companyId,
        entry: {
          fiscal_year_id: fiscalYearId,
          status: 'validee',
          entry_date: { gte: start, lte: end },
        },
      },
      include: { account: { select: { code: true, label: true, type: true } } },
    });

    const map = new Map<string, AccountBalance>();
    for (const line of lines) {
      const key = line.account.code;
      if (!map.has(key)) {
        map.set(key, {
          account_code:  line.account.code,
          account_label: line.account.label,
          debit_total:   0,
          credit_total:  0,
          solde:         0,
        });
      }
      const acc = map.get(key)!;
      acc.debit_total  += Number(line.debit);
      acc.credit_total += Number(line.credit);
      acc.solde = acc.debit_total - acc.credit_total;
    }
    return Array.from(map.values());
  }

  private async getAccountBalancesInPeriod(
    companyId: string,
    start: Date,
    end: Date,
  ): Promise<AccountBalance[]> {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        company_id: companyId,
        entry: { status: 'validee', entry_date: { gte: start, lte: end } },
      },
      include: { account: { select: { code: true, label: true } } },
    });
    const map = new Map<string, AccountBalance>();
    for (const line of lines) {
      const key = line.account.code;
      if (!map.has(key)) map.set(key, { account_code: key, account_label: line.account.label, debit_total: 0, credit_total: 0, solde: 0 });
      const acc = map.get(key)!;
      acc.debit_total  += Number(line.debit);
      acc.credit_total += Number(line.credit);
      acc.solde = acc.debit_total - acc.credit_total;
    }
    return Array.from(map.values());
  }

  // ── Construction données DSF ──────────────────────────────
  private buildDsfData(
    balances: AccountBalance[],
    mappings: any[],
    assets: any[],
    company: any,
    fiscalYear: any,
  ) {
    const getBalance = (codeStart: string, codeEnd?: string) => {
      return balances
        .filter(b => b.account_code >= codeStart && b.account_code <= (codeEnd ?? codeStart + 'z'))
        .reduce((sum, b) => sum + b.solde, 0);
    };

    // ── Bilan Actif
    const bilan_actif_lines: any[] = [];
    const bilanActifMappings = mappings.filter(m => m.financial_state === 'bilan_actif');
    for (const m of bilanActifMappings) {
      const solde = getBalance(m.account_code_start, m.account_code_end ?? undefined);
      bilan_actif_lines.push({
        ligne: m.dsf_line, libelle: m.dsf_label,
        montant: Math.abs(solde) * m.sign,
      });
    }

    // ── Bilan Passif
    const bilan_passif_lines: any[] = [];
    const bilanPassifMappings = mappings.filter(m => m.financial_state === 'bilan_passif');
    for (const m of bilanPassifMappings) {
      const solde = getBalance(m.account_code_start, m.account_code_end ?? undefined);
      bilan_passif_lines.push({
        ligne: m.dsf_line, libelle: m.dsf_label,
        montant: Math.abs(solde) * m.sign,
      });
    }

    // ── Compte de résultat
    const totalProduits = balances.filter(b => b.account_code.startsWith('7')).reduce((s, b) => s + b.credit_total, 0);
    const totalCharges  = balances.filter(b => b.account_code.startsWith('6')).reduce((s, b) => s + b.debit_total, 0);
    const resultatNet   = totalProduits - totalCharges;

    // ── Tableau immobilisations
    const tableau_immobilisations = assets.map((a: any) => {
      const depLine = a.depreciation_lines?.[0];
      return {
        nom:                a.name,
        valeur_brute:       Number(a.gross_value),
        dotation_exercice:  depLine ? Number(depLine.depreciation_amount) : 0,
        amort_cumules:      depLine ? Number(depLine.accumulated_amount)  : 0,
        valeur_nette:       depLine ? Number(depLine.net_book_value)       : Number(a.gross_value),
      };
    });

    const totalActif  = bilan_actif_lines.reduce((s, l) => s + l.montant, 0);
    const totalPassif = bilan_passif_lines.reduce((s, l) => s + l.montant, 0) + resultatNet;

    return {
      bilan_actif:  { lines: bilan_actif_lines,  total: totalActif },
      bilan_passif: { lines: bilan_passif_lines, total: totalPassif, resultat_exercice: resultatNet },
      resultat: {
        total_produits: totalProduits,
        total_charges:  totalCharges,
        resultat_net:   resultatNet,
        nature:         resultatNet >= 0 ? 'benefice' : 'perte',
      },
      tableau_immobilisations,
    };
  }
}
