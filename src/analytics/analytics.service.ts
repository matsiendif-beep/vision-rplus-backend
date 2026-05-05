import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  // ── Dashboard principal ───────────────────────────────────
  async getDashboard(companyId: string, fiscalYearId: string) {
    const [company, fiscalYear] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, company_id: companyId } }),
    ]);
    if (!fiscalYear) throw new NotFoundException('Exercice introuvable');

    const balances = await this.getBalances(companyId, fiscalYearId);

    const totalProduits = this.sumByPrefix(balances, '7');
    const totalCharges  = this.sumByPrefix(balances, '6');
    const resultatNet   = totalProduits - totalCharges;

    const tresorerie = this.sumByPrefix(balances, '5') + this.sumByPrefix(balances, '53');
    const clientsNet = this.sumByPrefix(balances, '411');
    const foursNet   = this.sumByPrefix(balances, '401');

    const kpis = this.computeKpis(balances, totalProduits, totalCharges);

    const alertes = await this.generateAlerts(companyId, {
      tresorerie, resultatNet, totalCharges, totalProduits,
    });

    return {
      company:     { name: company.name, currency: company.currency },
      fiscal_year: { label: fiscalYear.label, start: fiscalYear.start_date, end: fiscalYear.end_date },
      synthese: {
        total_produits: totalProduits,
        total_charges:  totalCharges,
        resultat_net:   resultatNet,
        nature:         resultatNet >= 0 ? 'benefice' : 'perte',
        tresorerie,
        clients_net:    clientsNet,
        fournisseurs_net: foursNet,
      },
      kpis,
      alertes,
      evolution: await this.getEvolution(companyId, fiscalYearId),
    };
  }

  // ── KPIs financiers ───────────────────────────────────────
  async getKpis(companyId: string, fiscalYearId: string) {
    const balances = await this.getBalances(companyId, fiscalYearId);
    const produits = this.sumByPrefix(balances, '7');
    const charges  = this.sumByPrefix(balances, '6');
    return this.computeKpis(balances, produits, charges);
  }

  // ── Balance générale ─────────────────────────────────────
  async getBalance(companyId: string, fiscalYearId: string) {
    const balances = await this.getBalances(companyId, fiscalYearId);
    return {
      comptes: balances,
      total_debit:  balances.reduce((s, b) => s + b.debit_total, 0),
      total_credit: balances.reduce((s, b) => s + b.credit_total, 0),
    };
  }

  // ── Grand livre ───────────────────────────────────────────
  async getGrandLivre(
    companyId: string,
    fiscalYearId: string,
    accountCode?: string,
  ) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        company_id: companyId,
        entry: {
          fiscal_year_id: fiscalYearId,
          status: 'validee',
        },
        ...(accountCode ? { account: { code: { startsWith: accountCode } } } : {}),
      },
      include: {
        account: { select: { code: true, label: true } },
        entry:   { select: { entry_date: true, reference: true, libelle: true, journal_type: true } },
      },
      orderBy: [{ account: { code: 'asc' } }, { entry: { entry_date: 'asc' } }],
    });

    // Grouper par compte
    const byAccount = new Map<string, any>();
    for (const line of lines) {
      const key = line.account.code;
      if (!byAccount.has(key)) {
        byAccount.set(key, {
          code: line.account.code, label: line.account.label,
          mouvements: [], debit_total: 0, credit_total: 0, solde: 0,
        });
      }
      const acc = byAccount.get(key)!;
      const debit  = Number(line.debit);
      const credit = Number(line.credit);
      acc.mouvements.push({
        date:      line.entry.entry_date,
        reference: line.entry.reference,
        libelle:   line.libelle ?? line.entry.libelle,
        journal:   line.entry.journal_type,
        debit, credit,
      });
      acc.debit_total  += debit;
      acc.credit_total += credit;
      acc.solde = acc.debit_total - acc.credit_total;
    }
    return Array.from(byAccount.values());
  }

  // ── Évolution mensuelle ───────────────────────────────────
  private async getEvolution(companyId: string, fiscalYearId: string) {
    const entries = await this.prisma.journalEntry.findMany({
      where: { company_id: companyId, fiscal_year_id: fiscalYearId, status: 'validee' },
      include: { lines: { include: { account: { select: { code: true } } } } },
      orderBy: { entry_date: 'asc' },
    });

    const byMonth: Record<string, { produits: number; charges: number }> = {};
    for (const entry of entries) {
      const monthKey = entry.entry_date.toISOString().slice(0, 7);
      if (!byMonth[monthKey]) byMonth[monthKey] = { produits: 0, charges: 0 };
      for (const line of entry.lines) {
        if (line.account.code.startsWith('7')) byMonth[monthKey].produits += Number(line.credit);
        if (line.account.code.startsWith('6')) byMonth[monthKey].charges  += Number(line.debit);
      }
    }
    return Object.entries(byMonth).map(([mois, data]) => ({ mois, ...data }));
  }

  // ── Calcul KPIs ───────────────────────────────────────────
  private computeKpis(
    balances: any[],
    totalProduits: number,
    totalCharges: number,
  ) {
    const resultatNet = totalProduits - totalCharges;
    const dotations   = this.sumByPrefix(balances, '68');
    const caf         = resultatNet + dotations;
    const tresorerie  = this.sumByPrefix(balances, '5');
    const dettes      = this.sumByPrefix(balances, '16') + this.sumByPrefix(balances, '17');
    const actif       = this.sumByPrefix(balances, '1') + this.sumByPrefix(balances, '2') + this.sumByPrefix(balances, '3') + this.sumByPrefix(balances, '4') + this.sumByPrefix(balances, '5');
    const chargesVariables = totalCharges * 0.6; // estimation
    const seuilRentabilite = totalCharges > 0 ? (chargesVariables / (1 - chargesVariables / Math.max(totalProduits, 1))) : 0;

    return {
      caf:                   Math.round(caf * 100) / 100,
      tresorerie_nette:      Math.round(tresorerie * 100) / 100,
      rentabilite_nette_pct: totalProduits > 0 ? Math.round((resultatNet / totalProduits) * 10000) / 100 : 0,
      endettement:           actif > 0 ? Math.round((dettes / actif) * 10000) / 100 : 0,
      seuil_rentabilite:     Math.round(seuilRentabilite * 100) / 100,
    };
  }

  // ── Génération alertes ────────────────────────────────────
  private async generateAlerts(
    companyId: string,
    data: { tresorerie: number; resultatNet: number; totalCharges: number; totalProduits: number },
  ) {
    const alertes: { type: string; message: string; severity: string }[] = [];

    if (data.tresorerie < 0) {
      alertes.push({ type: 'tresorerie_negative', message: 'Trésorerie négative — risque de cessation de paiement', severity: 'critique' });
    } else if (data.tresorerie < data.totalCharges * 0.1) {
      alertes.push({ type: 'tresorerie_faible', message: 'Trésorerie faible — moins d\'un mois de charges', severity: 'attention' });
    }

    if (data.resultatNet < 0) {
      alertes.push({ type: 'resultat_negatif', message: 'Résultat déficitaire — revoir la structure des coûts', severity: 'attention' });
    }

    if (data.totalProduits > 0 && data.totalCharges / data.totalProduits > 0.9) {
      alertes.push({ type: 'marges_faibles', message: 'Charges supérieures à 90% du CA — marges très faibles', severity: 'attention' });
    }

    // Persister les nouvelles alertes critiques
    for (const alerte of alertes.filter(a => a.severity === 'critique')) {
      await this.prisma.financialAlert.create({
        data: {
          company_id: companyId,
          type:       alerte.type as any,
          message:    alerte.message,
          metadata:   { severity: alerte.severity } as any,
        },
      });
    }

    return alertes;
  }

  // ── Utilitaires ───────────────────────────────────────────
  private async getBalances(companyId: string, fiscalYearId: string) {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        company_id: companyId,
        entry: { fiscal_year_id: fiscalYearId, status: 'validee' },
      },
      include: { account: { select: { code: true, label: true, type: true } } },
    });

    const map = new Map<string, any>();
    for (const line of lines) {
      const key = line.account.code;
      if (!map.has(key)) {
        map.set(key, {
          account_code: key, account_label: line.account.label,
          account_type: line.account.type, debit_total: 0, credit_total: 0, solde: 0,
        });
      }
      const acc = map.get(key)!;
      acc.debit_total  += Number(line.debit);
      acc.credit_total += Number(line.credit);
      acc.solde = acc.debit_total - acc.credit_total;
    }
    return Array.from(map.values());
  }

  private sumByPrefix(balances: any[], prefix: string): number {
    return balances
      .filter(b => b.account_code.startsWith(prefix))
      .reduce((s, b) => s + b.solde, 0);
  }
}
