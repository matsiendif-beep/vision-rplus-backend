import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { isOhadaClass8Charge, PlanSystem } from '../accounting-plans';

// Règle de classement (source : demande du fondateur, conforme PCG et SYSCOHADA) :
//   classes 1 à 5 → bilan ; classes 6 à 8 → compte de résultat
//   (classe 8 : SYSCOHADA uniquement — 81/83/85/87/89 charges, 82/84/86/88 produits ;
//    la classe 9 — engagements hors bilan, analytique — n'entre dans aucun des deux).
const isChargeCode  = (sys: PlanSystem, c: string) => c[0] === '6' || (sys === 'ohada' && c[0] === '8' && isOhadaClass8Charge(c));
const isProduitCode = (sys: PlanSystem, c: string) => c[0] === '7' || (sys === 'ohada' && c[0] === '8' && !isOhadaClass8Charge(c));

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private async systemOf(companyId: string): Promise<PlanSystem> {
    const c = await this.prisma.company.findUnique({ where: { id: companyId }, select: { accounting_system: true } });
    if (!c) throw new NotFoundException('Entreprise introuvable');
    return c.accounting_system as PlanSystem;
  }

  /** Total des charges (solde débiteur) et des produits (solde créditeur) de l'exercice. */
  private resultParts(balances: any[], sys: PlanSystem) {
    let charges = 0, produits = 0;
    for (const b of balances) {
      if (isChargeCode(sys, b.account_code))  charges  += b.solde;
      if (isProduitCode(sys, b.account_code)) produits -= b.solde;
    }
    return { charges, produits, resultat: produits - charges };
  }

  // ── Dashboard principal ───────────────────────────────────
  async getDashboard(companyId: string, fiscalYearId: string) {
    const [company, fiscalYear] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.fiscalYear.findFirst({ where: { id: fiscalYearId, company_id: companyId } }),
    ]);
    if (!fiscalYear) throw new NotFoundException('Exercice introuvable');

    const balances = await this.getBalances(companyId, fiscalYearId);

    // Classes 6 à 8 (classe 8 : SYSCOHADA)
    const { produits: totalProduits, charges: totalCharges, resultat: resultatNet } =
      this.resultParts(balances, company.accounting_system as PlanSystem);

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

  /** Alertes financières de l'exercice (même règles que le tableau de bord, sans enregistrement). */
  async computeFinancialAlerts(companyId: string, fiscalYearId: string) {
    const [balances, sys] = await Promise.all([this.getBalances(companyId, fiscalYearId), this.systemOf(companyId)]);
    if (!balances.length) return [];
    const { produits, charges, resultat } = this.resultParts(balances, sys);
    const tresorerie = this.sumByPrefix(balances, '5');
    const out: { type: string; message: string; severity: 'critique' | 'attention' }[] = [];
    if (tresorerie < 0) out.push({ type: 'tresorerie_negative', message: 'Trésorerie négative : risque de difficultés de paiement', severity: 'critique' });
    else if (charges > 0 && tresorerie < charges * 0.1) out.push({ type: 'tresorerie_faible', message: 'Trésorerie faible : moins de 10 % des charges de l\'exercice', severity: 'attention' });
    if (resultat < 0) out.push({ type: 'resultat_negatif', message: 'Résultat déficitaire sur l\'exercice', severity: 'attention' });
    if (produits > 0 && charges / produits > 0.9) out.push({ type: 'marges_faibles', message: 'Charges supérieures à 90 % du chiffre d\'affaires : marges très faibles', severity: 'attention' });
    return out;
  }

  // ── KPIs financiers ───────────────────────────────────────
  async getKpis(companyId: string, fiscalYearId: string) {
    const [balances, sys] = await Promise.all([this.getBalances(companyId, fiscalYearId), this.systemOf(companyId)]);
    const { produits, charges } = this.resultParts(balances, sys);
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
    const sys = await this.systemOf(companyId);
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
        const code = line.account.code;
        if (isProduitCode(sys, code)) byMonth[monthKey].produits += Number(line.credit) - Number(line.debit);
        if (isChargeCode(sys, code))  byMonth[monthKey].charges  += Number(line.debit)  - Number(line.credit);
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

    // Persister les nouvelles alertes critiques (une seule non lue par type :
    // auparavant, chaque affichage du tableau de bord en recréait une)
    for (const alerte of alertes.filter(a => a.severity === 'critique')) {
      const exists = await this.prisma.financialAlert.findFirst({
        where: { company_id: companyId, type: alerte.type as any, is_read: false },
        select: { id: true },
      });
      if (exists) continue;
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

  // ── Bilan (PCG et SYSCOHADA) ──────────────────────────────
  //  Tous les comptes des classes 1 à 5 sont repris (aucun oubli possible,
  //  y compris les sous-comptes créés par l'utilisateur) ; le résultat vient
  //  des classes 6 à 8. Le bilan est donc équilibré par construction
  //  dès lors que les écritures sont équilibrées.
  async getBilan(companyId: string, fiscalYearId: string) {
    const [balances, sys] = await Promise.all([this.getBalances(companyId, fiscalYearId), this.systemOf(companyId)]);
    const ohada = sys === 'ohada';

    // Rubriques d'immobilisations (les amortissements 28X et dépréciations 29X
    // viennent en déduction de la rubrique 2X correspondante)
    const INCORP = ohada ? ['20', '21'] : ['20'];
    const CORP   = ohada ? ['22', '23', '24', '25'] : ['21', '22', '23'];
    const underlying = (c: string) => (/^2[89]\d/.test(c) ? '2' + c[2] : c.slice(0, 2));
    // Dettes financières : SYSCOHADA 16-19 (19 = provisions pour risques) ; PCG 15-17 (15 = provisions)
    const DETTES_FIN = ohada ? ['16', '17', '18', '19'] : ['15', '16', '17'];
    // Capital : SYSCOHADA classe 10 (les réserves sont en 11) ;
    // PCG 101 capital, 108 compte de l'exploitant, 109 capital non appelé (106 = réserves)
    const CAPITAL = ohada ? ['10'] : ['101', '108', '109'];

    let immoIncorp = 0, immoCorp = 0, immoFin = 0, stocks = 0;
    let creancesClients = 0, autresCreances = 0, tresorerieActif = 0;
    let capital = 0, reserves = 0, empruntsLT = 0, fournisseurs = 0, autresDettes = 0, tresoreriePassif = 0;

    for (const b of balances) {
      const c: string = b.account_code, s: number = b.solde;   // solde = débit − crédit
      switch (c[0]) {
        case '1':
          if (CAPITAL.some((p) => c.startsWith(p))) capital -= s;
          else if (DETTES_FIN.some((p) => c.startsWith(p))) empruntsLT -= s;
          else reserves -= s;                                   // réserves, report à nouveau, subventions, provisions réglementées…
          break;
        case '2': {
          const u = underlying(c);
          if (INCORP.includes(u)) immoIncorp += s; else if (CORP.includes(u)) immoCorp += s; else immoFin += s;
          break;
        }
        case '3': stocks += s; break;                           // y compris dépréciations 39 (en déduction)
        case '4':
          if (c.startsWith('49'))      autresCreances += s;      // dépréciations des comptes de tiers (en déduction)
          else if (s > 0)              { if (c.startsWith('41')) creancesClients += s; else autresCreances += s; }
          else if (s < 0)              { if (c.startsWith('40')) fournisseurs -= s;    else autresDettes -= s; }
          break;
        case '5':
          if (c.startsWith('59'))      tresorerieActif += s;     // dépréciations (en déduction)
          else if (s >= 0)             tresorerieActif += s;
          else                         tresoreriePassif -= s;    // découverts, crédits de trésorerie
          break;
      }
    }

    const { resultat: resultatNet } = this.resultParts(balances, sys);
    const totalActif  = immoIncorp + immoCorp + immoFin + stocks + creancesClients + autresCreances + tresorerieActif;
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
      system:    sys,
    };
  }

  // ── Compte de résultat (classes 6 à 8) ────────────────────
  //  Rubriques selon le plan de l'entreprise :
  //   SYSCOHADA : 60 achats · 61-63 services extérieurs · 64 impôts et taxes ·
  //               66 personnel · 67 frais financiers · 68-69 dotations · 89 impôt ;
  //               70 ventes · 71 subventions · 77 revenus financiers ; classe 8 HAO
  //   PCG       : 60 achats · 61-62 services extérieurs · 63 impôts et taxes ·
  //               64 personnel · 66 charges financières · 68 dotations · 69 impôt ;
  //               70 ventes · 74 subventions · 76 produits financiers
  async getCompteResultat(companyId: string, fiscalYearId: string) {
    const [balances, sys] = await Promise.all([this.getBalances(companyId, fiscalYearId), this.systemOf(companyId)]);
    const ohada = sys === 'ohada';
    const sumCh = (...p: string[]) => balances.filter((b) => isChargeCode(sys, b.account_code) && p.some((x) => b.account_code.startsWith(x))).reduce((s, b) => s + b.solde, 0);
    const sumPr = (...p: string[]) => -balances.filter((b) => isProduitCode(sys, b.account_code) && p.some((x) => b.account_code.startsWith(x))).reduce((s, b) => s + b.solde, 0);
    const { produits: totalProduits, charges: totalCharges, resultat: resultatNet } = this.resultParts(balances, sys);

    const ca       = sumPr('70');
    const subvExpl = ohada ? sumPr('71') : sumPr('74');
    const prodFin  = ohada ? sumPr('77') : sumPr('76');
    const autresProd = totalProduits - ca - subvExpl - prodFin;   // dont produits HAO (classe 8)

    const achats        = sumCh('60');
    const servicesExt   = ohada ? sumCh('61', '62', '63') : sumCh('61', '62');
    const impotsTaxes   = ohada ? sumCh('64') : sumCh('63');
    const chargesPers   = ohada ? sumCh('66') : sumCh('64');
    const chargesFin    = ohada ? sumCh('67') : sumCh('66');
    const dotations     = ohada ? sumCh('68', '69') : sumCh('68');
    const impotResultat = ohada ? sumCh('89') : sumCh('69');
    const autresCharges = totalCharges - achats - servicesExt - impotsTaxes - chargesPers - chargesFin - dotations - impotResultat;

    return {
      produits: {
        chiffre_affaires:    ca,
        subventions_expl:    subvExpl,
        autres_produits:     autresProd,
        produits_financiers: prodFin,
        total_produits:      totalProduits,
      },
      charges: {
        achats_variation_stocks:  achats,
        services_exterieurs:      servicesExt,
        impots_taxes:             impotsTaxes,
        charges_personnel:        chargesPers,
        autres_charges:           autresCharges,   // dont charges HAO (classe 8) et charges exceptionnelles
        charges_financieres:      chargesFin,
        dotations_amortissements: dotations,
        impot_sur_resultat:       impotResultat,
        total_charges:            totalCharges,
      },
      resultat_net:    resultatNet,
      nature:          resultatNet >= 0 ? 'benefice' : 'perte',
      nature_resultat: resultatNet >= 0 ? 'benefice' : 'perte',
      system:          sys,
      marge_brute:     totalProduits > 0 ? Math.round((resultatNet / totalProduits) * 10000) / 100 : 0,
    };
  }
}
