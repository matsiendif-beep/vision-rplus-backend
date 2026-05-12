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

    const totalProduits = -this.sumByPrefix(balances, '7'); // Classe 7: solde créditeur (négatif) → inversé
    const totalCharges  =  this.sumByPrefix(balances, '6'); // Classe 6: solde débiteur (positif)
    const resultatNet   = totalProduits - totalCharges;

    const tresorerie = this.sumByPrefix(balances, '5');
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
    const produits = -this.sumByPrefix(balances, '7');
    const charges  =  this.sumByPrefix(balances, '6');
    return this.computeKpis(balances, produits, charges);
  }

  // ── Balance générale ─────────────────────────────────────
  async getBalance(companyId: string, fiscalYearId: string) {
    const balances = await this.getBalances(companyId, fiscalYearId);
    const sorted   = [...balances].sort((a, b) => a.account_code.localeCompare(b.account_code));
    return {
      comptes:      sorted,
      total_debit:  balances.reduce((s, b) => s + b.debit_total, 0),
      total_credit: balances.reduce((s, b) => s + b.credit_total, 0),
    };
  }

  // ── Export FEC (Fichier des Écritures Comptables — norme DGFiP France) ─
  async exportFec(companyId: string, fiscalYearId: string): Promise<string> {
    const lines = await this.prisma.journalLine.findMany({
      where: {
        company_id: companyId,
        entry: { fiscal_year_id: fiscalYearId, status: 'validee' },
      },
      include: {
        account: { select: { code: true, label: true } },
        entry:   { select: { id: true, entry_date: true, reference: true, libelle: true, journal_type: true } },
      },
      orderBy: [{ entry: { entry_date: 'asc' } }, { line_order: 'asc' }],
    });

    const JOURNAL_LABELS: Record<string, string> = {
      achats: 'Journal des achats', ventes: 'Journal des ventes',
      banque: 'Journal de banque',  caisse: 'Journal de caisse',
      od:     'Opérations diverses', salaires: 'Journal des salaires',
      actif:  "Journal d'actif",
    };

    const header = [
      'JournalCode', 'JournalLib', 'EcritureNum', 'EcritureDate',
      'CompteNum', 'CompteLib', 'CompAuxNum', 'CompAuxLib',
      'PieceRef', 'PieceDate', 'EcritureLib',
      'Debit', 'Credit', 'EcritureLet', 'DateLet', 'ValidDate',
    ].join('\t');

    const journalCounters: Record<string, number> = {};
    const entryNums: Record<string, string> = {};
    for (const l of lines) {
      if (!entryNums[l.entry.id]) {
        const j = l.entry.journal_type.toUpperCase();
        journalCounters[j] = (journalCounters[j] ?? 0) + 1;
        entryNums[l.entry.id] = `${j}${String(journalCounters[j]).padStart(6, '0')}`;
      }
    }

    const rows = lines.map(l => [
      l.entry.journal_type,
      JOURNAL_LABELS[l.entry.journal_type] ?? l.entry.journal_type,
      entryNums[l.entry.id],
      l.entry.entry_date.toISOString().slice(0, 10).replace(/-/g, ''),
      l.account.code,
      l.account.label,
      '', '',
      l.entry.reference ?? l.entry.id.slice(0, 8).toUpperCase(),
      l.entry.entry_date.toISOString().slice(0, 10).replace(/-/g, ''),
      l.libelle ?? l.entry.libelle,
      Number(l.debit).toFixed(2).replace('.', ','),
      Number(l.credit).toFixed(2).replace('.', ','),
      '', '', '',
    ].join('\t'));

    return [header, ...rows].join('\r\n');
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

  // ── Bilan OHADA ───────────────────────────────────────────
  async getBilan(companyId: string, fiscalYearId: string) {
    const balances = await this.getBalances(companyId, fiscalYearId);

    const solde = (prefix: string) => this.sumByPrefix(balances, prefix);

    // ACTIF
    const immoCorp   = solde('22') + solde('23') + solde('24') + solde('25');
    const immoIncorp = solde('21') + solde('20');
    const immoFin    = solde('26') + solde('27') + solde('28');
    const stocks     = solde('3');
    const creancesClients  = solde('411') + solde('412');
    const autresCreances   = Math.max(0,
      balances.filter(b => b.account_code.startsWith('4') &&
        !b.account_code.startsWith('401') &&
        !b.account_code.startsWith('402') &&
        !b.account_code.startsWith('411') &&
        !b.account_code.startsWith('412'))
        .reduce((s, b) => s + Math.max(0, b.solde), 0)
    );
    const tresorerieActif = Math.max(0, solde('5'));

    const totalActif = immoCorp + immoIncorp + immoFin + stocks + creancesClients + autresCreances + tresorerieActif;

    // PASSIF
    const capital    = Math.abs(solde('101') + solde('102') + solde('103') + solde('104'));
    const reserves   = Math.abs(solde('11') + solde('12') + solde('13'));
    const produits   = -this.sumByPrefix(balances, '7'); // Classe 7: solde créditeur → inversé
    const charges    =  this.sumByPrefix(balances, '6'); // Classe 6: solde débiteur
    const resultatNet = produits - charges;
    const empruntsLT  = Math.abs(solde('16') + solde('17') + solde('18'));
    const fournisseurs = Math.abs(solde('401') + solde('402'));
    const autresDettes = Math.abs(
      balances.filter(b => b.account_code.startsWith('4') &&
        !b.account_code.startsWith('401') &&
        !b.account_code.startsWith('402') &&
        !b.account_code.startsWith('411') &&
        !b.account_code.startsWith('412'))
        .reduce((s, b) => s + Math.min(0, b.solde), 0)
    );
    const tresoreriePassif = Math.abs(Math.min(0, solde('5')));

    const totalPassif = capital + reserves + resultatNet + empruntsLT + fournisseurs + autresDettes + tresoreriePassif;

    return {
      actif: {
        immobilisations: {
          incorporelles: immoIncorp,
          corporelles:   immoCorp,
          financieres:   immoFin,
          total:         immoIncorp + immoCorp + immoFin,
        },
        actif_circulant: {
          stocks,
          creances_clients:  creancesClients,
          autres_creances:   autresCreances,
          total:             stocks + creancesClients + autresCreances,
        },
        tresorerie_actif: tresorerieActif,
        total_actif:      totalActif,
      },
      passif: {
        capitaux_propres: {
          capital,
          reserves,
          resultat_net:  resultatNet,
          total:         capital + reserves + resultatNet,
        },
        dettes_financieres: {
          emprunts_lt:  empruntsLT,
          total:        empruntsLT,
        },
        passif_circulant: {
          fournisseurs,
          autres_dettes: autresDettes,
          total:         fournisseurs + autresDettes,
        },
        tresorerie_passif: tresoreriePassif,
        total_passif:      totalPassif,
      },
      equilibre: Math.abs(totalActif - totalPassif) < 1,
    };
  }

  // ── Compte de résultat ───────────────────────────────────
  async getCompteResultat(companyId: string, fiscalYearId: string) {
    const balances = await this.getBalances(companyId, fiscalYearId);
    const solde = (prefix: string) => Math.abs(this.sumByPrefix(balances, prefix));

    // ── Produits (classe 7 complète) ─────────────────────────
    const ca           = solde('70') + solde('71') + solde('72');
    const subvExpl     = solde('74');
    const autresProd   = solde('73') + solde('75') + solde('77') + solde('78') + solde('79');
    const prodFin      = solde('76');
    const totalProduitsEnum = ca + subvExpl + autresProd + prodFin;
    // Catch-all: tout ce qui est en classe 7 mais non capturé ci-dessus
    const totalProduits7 = Math.abs(this.sumByPrefix(balances, '7'));
    const autresProdCatchAll = Math.max(0, totalProduits7 - totalProduitsEnum);
    const totalProduits = totalProduits7; // on utilise la vraie somme classe 7

    // ── Charges (classe 6 complète) ──────────────────────────
    const achats         = solde('60') + solde('61');
    const servicesExt    = solde('62');
    const impotsTaxes    = solde('63');
    const chargesPers    = solde('64');
    const autresGestion  = solde('65');
    const chargesFin     = solde('66');
    const chargesExcept  = solde('67'); // Charges exceptionnelles (ex: 674 Charges sociales)
    const dotations      = solde('68');
    const impotResultat  = solde('69') + solde('89');
    const totalChargesEnum = achats + servicesExt + impotsTaxes + chargesPers + autresGestion + chargesFin + chargesExcept + dotations + impotResultat;
    // Catch-all: tout ce qui est en classe 6 mais non capturé ci-dessus
    const totalCharges6 = this.sumByPrefix(balances, '6');
    const autresChargesCatchAll = Math.max(0, totalCharges6 - totalChargesEnum);
    const totalCharges = totalCharges6; // on utilise la vraie somme classe 6

    const resultatNet = totalProduits - totalCharges;

    return {
      produits: {
        chiffre_affaires:    ca,
        subventions_expl:    subvExpl,
        autres_produits:     autresProd + autresProdCatchAll,
        produits_financiers: prodFin,
        total_produits:      totalProduits,
      },
      charges: {
        achats_variation_stocks:  achats,
        services_exterieurs:      servicesExt,
        impots_taxes:             impotsTaxes,
        charges_personnel:        chargesPers,
        autres_charges:           autresGestion + chargesExcept + autresChargesCatchAll,
        charges_financieres:      chargesFin,
        dotations_amortissements: dotations,
        impot_sur_resultat:       impotResultat,
        total_charges:            totalCharges,
      },
      resultat_net:    resultatNet,
      nature:          resultatNet >= 0 ? 'benefice' : 'perte',
      nature_resultat: resultatNet >= 0 ? 'benefice' : 'perte',
      marge_brute:     totalProduits > 0 ? Math.round((resultatNet / totalProduits) * 10000) / 100 : 0,
    };
  }
}
