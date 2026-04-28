import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

// ── Types ─────────────────────────────────────────────────────

export type AccountNature = 'debiteur' | 'crediteur';

export interface AccountBalance {
  account_id    : string;
  account_code  : string;
  account_label : string;
  account_type  : string;
  total_debit   : number;
  total_credit  : number;
  solde         : number;
  nature        : AccountNature;
}

export interface IncomeStatement {
  produits        : AccountBalance[];
  charges         : AccountBalance[];
  total_produits  : number;
  total_charges   : number;
  resultat_net    : number;
  nature_resultat : 'benefice' | 'perte' | 'equilibre';
}

export interface BalanceSheet {
  actif: {
    immobilisations  : AccountBalance[];
    stocks           : AccountBalance[];
    creances         : AccountBalance[];
    tresorerie       : AccountBalance[];
    total_actif      : number;
  };
  passif: {
    capitaux_propres      : AccountBalance[];
    dettes_fournisseurs   : AccountBalance[];
    dettes_fiscales_sociales: AccountBalance[];
    emprunts              : AccountBalance[];
    resultat_exercice     : number;
    total_passif          : number;
  };
  is_balanced    : boolean;
  ecart_bilan    : number;
}

// ─────────────────────────────────────────────────────────────

@Injectable()
export class AccountingEngine {
  constructor(private prisma: PrismaService) {}

  // ══════════════════════════════════════════════════════════
  //  1. RÈGLE FONDAMENTALE : calcul du solde selon le type
  // ══════════════════════════════════════════════════════════
  computeBalance(
    totalDebit  : number,
    totalCredit : number,
    accountType : string,
  ): { solde: number; nature: AccountNature } {
    const isDebitNormal = ['actif', 'charge', 'tresorerie'].includes(accountType);

    const solde = isDebitNormal
      ? totalDebit - totalCredit   // Actif/Charge : solde débiteur normal
      : totalCredit - totalDebit;  // Passif/Produit : solde créditeur normal

    const nature: AccountNature =
      solde >= 0
        ? isDebitNormal ? 'debiteur' : 'crediteur'
        : isDebitNormal ? 'crediteur' : 'debiteur';

    return { solde: Math.abs(solde), nature };
  }

  // ══════════════════════════════════════════════════════════
  //  2. VALIDATION ÉCRITURE : débit = crédit
  // ══════════════════════════════════════════════════════════
  validateEntry(lines: { debit: number; credit: number }[]): void {
    if (lines.length < 2) {
      throw new Error('Une écriture doit comporter au moins 2 lignes');
    }

    for (const line of lines) {
      if (line.debit > 0 && line.credit > 0) {
        throw new Error('Une ligne ne peut pas avoir débit ET crédit non nuls simultanément');
      }
      if (line.debit === 0 && line.credit === 0) {
        throw new Error('Ligne à montant zéro interdite');
      }
    }

    const totalDebit  = lines.reduce((s, l) => s + l.debit,  0);
    const totalCredit = lines.reduce((s, l) => s + l.credit, 0);

    // Tolérance de 0.01€ pour les arrondis
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new Error(
        `Écriture déséquilibrée : débit=${totalDebit.toFixed(2)} ≠ crédit=${totalCredit.toFixed(2)}. ` +
        `Écart : ${Math.abs(totalDebit - totalCredit).toFixed(2)}`,
      );
    }
  }

  // ══════════════════════════════════════════════════════════
  //  3. GRAND LIVRE : soldes de tous les comptes
  // ══════════════════════════════════════════════════════════
  async getAccountBalances(
    companyId     : string,
    fiscalYearId  : string,
    accountTypes? : string[],
  ): Promise<AccountBalance[]> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        a.id          AS account_id,
        a.code        AS account_code,
        a.label       AS account_label,
        a.type        AS account_type,
        COALESCE(SUM(jl.debit),  0)::float  AS total_debit,
        COALESCE(SUM(jl.credit), 0)::float  AS total_credit
      FROM accounts a
      LEFT JOIN journal_lines   jl ON jl.account_id = a.id
      LEFT JOIN journal_entries je ON je.id = jl.entry_id
        AND je.company_id      = ${companyId}
        AND je.fiscal_year_id  = ${fiscalYearId}
        AND je.status          = 'validee'
      WHERE
        (a.company_id = ${companyId} OR a.company_id IS NULL)
        AND a.is_active = true
        ${accountTypes?.length
          ? this.prisma.$queryRaw`AND a.type = ANY(${accountTypes}::text[])`
          : this.prisma.$queryRaw``
        }
      GROUP BY a.id, a.code, a.label, a.type
      HAVING COALESCE(SUM(jl.debit), 0) > 0
          OR COALESCE(SUM(jl.credit), 0) > 0
      ORDER BY a.code
    `;

    return rows.map((row) => {
      const { solde, nature } = this.computeBalance(
        Number(row.total_debit),
        Number(row.total_credit),
        row.account_type,
      );
      return {
        account_id:    row.account_id,
        account_code:  row.account_code,
        account_label: row.account_label,
        account_type:  row.account_type,
        total_debit:   Number(row.total_debit),
        total_credit:  Number(row.total_credit),
        solde,
        nature,
      };
    });
  }

  // ══════════════════════════════════════════════════════════
  //  4. COMPTE DE RÉSULTAT
  //     Produits (7xx) - Charges (6xx) = Résultat Net
  // ══════════════════════════════════════════════════════════
  async getIncomeStatement(
    companyId    : string,
    fiscalYearId : string,
  ): Promise<IncomeStatement> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        a.id          AS account_id,
        a.code        AS account_code,
        a.label       AS account_label,
        a.type        AS account_type,
        COALESCE(SUM(jl.debit),  0)::float AS total_debit,
        COALESCE(SUM(jl.credit), 0)::float AS total_credit,
        -- Solde selon le type
        CASE
          WHEN a.type = 'produit' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
          WHEN a.type = 'charge'  THEN COALESCE(SUM(jl.debit),  0) - COALESCE(SUM(jl.credit), 0)
        END::float AS solde
      FROM journal_lines   jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts        a  ON a.id  = jl.account_id
      WHERE
        jl.company_id      = ${companyId}
        AND je.fiscal_year_id  = ${fiscalYearId}
        AND je.status          = 'validee'
        AND a.type             IN ('charge', 'produit')
      GROUP BY a.id, a.code, a.label, a.type
      HAVING CASE
        WHEN a.type = 'produit' THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit), 0)
        WHEN a.type = 'charge'  THEN COALESCE(SUM(jl.debit),  0) - COALESCE(SUM(jl.credit), 0)
      END != 0
      ORDER BY a.type DESC, a.code
    `;

    const toBalance = (row: any): AccountBalance => ({
      account_id:    row.account_id,
      account_code:  row.account_code,
      account_label: row.account_label,
      account_type:  row.account_type,
      total_debit:   Number(row.total_debit),
      total_credit:  Number(row.total_credit),
      solde:         Math.abs(Number(row.solde)),
      nature:        row.account_type === 'produit' ? 'crediteur' : 'debiteur',
    });

    const produits = rows.filter((r) => r.account_type === 'produit').map(toBalance);
    const charges  = rows.filter((r) => r.account_type === 'charge').map(toBalance);

    const total_produits = produits.reduce((s, r) => s + r.solde, 0);
    const total_charges  = charges.reduce((s, r)  => s + r.solde, 0);
    const resultat_net   = total_produits - total_charges;

    return {
      produits,
      charges,
      total_produits,
      total_charges,
      resultat_net,
      nature_resultat:
        resultat_net > 0 ? 'benefice' :
        resultat_net < 0 ? 'perte'    : 'equilibre',
    };
  }

  // ══════════════════════════════════════════════════════════
  //  5. BILAN
  //     Actif (2xx+3xx+4x1+5xx) vs Passif (1xx+4x0+44x+16x)
  //     + Résultat Net intégré au passif
  // ══════════════════════════════════════════════════════════
  async getBalanceSheet(
    companyId    : string,
    fiscalYearId : string,
  ): Promise<BalanceSheet> {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        a.id          AS account_id,
        a.code        AS account_code,
        a.label       AS account_label,
        a.type        AS account_type,
        COALESCE(SUM(jl.debit),  0)::float AS total_debit,
        COALESCE(SUM(jl.credit), 0)::float AS total_credit,
        CASE
          WHEN a.type IN ('actif', 'tresorerie')
               THEN COALESCE(SUM(jl.debit), 0)  - COALESCE(SUM(jl.credit), 0)
          WHEN a.type = 'passif'
               THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit),  0)
        END::float AS solde_net
      FROM journal_lines   jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts        a  ON a.id  = jl.account_id
      WHERE
        jl.company_id      = ${companyId}
        AND je.fiscal_year_id  = ${fiscalYearId}
        AND je.status          = 'validee'
        AND a.type             IN ('actif', 'passif', 'tresorerie')
      GROUP BY a.id, a.code, a.label, a.type
      HAVING ABS(CASE
        WHEN a.type IN ('actif', 'tresorerie')
             THEN COALESCE(SUM(jl.debit), 0)  - COALESCE(SUM(jl.credit), 0)
        WHEN a.type = 'passif'
             THEN COALESCE(SUM(jl.credit), 0) - COALESCE(SUM(jl.debit),  0)
      END) > 0.001
      ORDER BY a.type DESC, a.code
    `;

    // Résultat net de l'exercice (pour l'intégrer au passif)
    const { resultat_net } = await this.getIncomeStatement(companyId, fiscalYearId);

    const toBalance = (row: any): AccountBalance => ({
      account_id:    row.account_id,
      account_code:  row.account_code,
      account_label: row.account_label,
      account_type:  row.account_type,
      total_debit:   Number(row.total_debit),
      total_credit:  Number(row.total_credit),
      solde:         Math.abs(Number(row.solde_net)),
      nature:        ['actif', 'tresorerie'].includes(row.account_type)
                       ? 'debiteur' : 'crediteur',
    });

    // ── Classification ACTIF ──────────────────────────────
    const byPrefix = (prefixes: string[]) =>
      rows
        .filter((r) => prefixes.some((p) => r.account_code.startsWith(p)))
        .map(toBalance);

    const immobilisations = byPrefix(['2']);
    const stocks          = byPrefix(['3']);
    const creances        = rows
      .filter((r) => ['411', '409', '445', '4455', '4456'].some((p) => r.account_code.startsWith(p)))
      .map(toBalance);
    const tresorerie      = rows
      .filter((r) => r.account_type === 'tresorerie')
      .map(toBalance);

    const total_actif =
      [...immobilisations, ...stocks, ...creances, ...tresorerie]
        .reduce((s, r) => s + r.solde, 0);

    // ── Classification PASSIF ─────────────────────────────
    const capitaux_propres        = byPrefix(['10', '11', '12', '13', '101', '111', '121']);
    const dettes_fournisseurs     = byPrefix(['401', '408']);
    const dettes_fiscales_sociales = byPrefix(['42', '43', '44']);
    const emprunts                = byPrefix(['16']);

    const total_passif_comptes =
      [...capitaux_propres, ...dettes_fournisseurs, ...dettes_fiscales_sociales, ...emprunts]
        .reduce((s, r) => s + r.solde, 0);

    // Résultat net s'ajoute au passif (bénéfice = +passif, perte = -passif)
    const total_passif = total_passif_comptes + resultat_net;

    const ecart = Math.abs(total_actif - total_passif);

    return {
      actif: {
        immobilisations,
        stocks,
        creances,
        tresorerie,
        total_actif,
      },
      passif: {
        capitaux_propres,
        dettes_fournisseurs,
        dettes_fiscales_sociales,
        emprunts,
        resultat_exercice: resultat_net,
        total_passif,
      },
      is_balanced: ecart < 0.01,
      ecart_bilan: ecart,
    };
  }

  // ══════════════════════════════════════════════════════════
  //  6. TRÉSORERIE : solde bancaire temps réel
  // ══════════════════════════════════════════════════════════
  async getCashBalance(companyId: string, fiscalYearId: string): Promise<number> {
    const result = await this.prisma.$queryRaw<any[]>`
      SELECT
        COALESCE(SUM(jl.debit), 0)::float  AS total_debit,
        COALESCE(SUM(jl.credit), 0)::float AS total_credit
      FROM journal_lines   jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts        a  ON a.id  = jl.account_id
      WHERE
        jl.company_id      = ${companyId}
        AND je.fiscal_year_id  = ${fiscalYearId}
        AND je.status          = 'validee'
        AND a.type             = 'tresorerie'
    `;

    const { total_debit, total_credit } = result[0] ?? { total_debit: 0, total_credit: 0 };
    return Number(total_debit) - Number(total_credit);
  }

  // ══════════════════════════════════════════════════════════
  //  7. ÉVOLUTION MENSUELLE (pour les graphiques dashboard)
  // ══════════════════════════════════════════════════════════
  async getMonthlyEvolution(companyId: string, fiscalYearId: string) {
    const rows = await this.prisma.$queryRaw<any[]>`
      SELECT
        DATE_TRUNC('month', je.entry_date)   AS month,
        a.type                               AS account_type,
        COALESCE(SUM(jl.debit),  0)::float  AS total_debit,
        COALESCE(SUM(jl.credit), 0)::float  AS total_credit
      FROM journal_lines   jl
      JOIN journal_entries je ON je.id = jl.entry_id
      JOIN accounts        a  ON a.id  = jl.account_id
      WHERE
        jl.company_id      = ${companyId}
        AND je.fiscal_year_id  = ${fiscalYearId}
        AND je.status          = 'validee'
        AND a.type             IN ('produit', 'charge', 'tresorerie')
      GROUP BY month, a.type
      ORDER BY month ASC
    `;

    // Réorganiser par mois pour les graphiques
    const months: Record<string, any> = {};
    for (const row of rows) {
      const key = new Date(row.month).toISOString().slice(0, 7); // 'YYYY-MM'
      if (!months[key]) months[key] = { month: key, produits: 0, charges: 0, tresorerie: 0 };

      if (row.account_type === 'produit') {
        months[key].produits  += Number(row.total_credit) - Number(row.total_debit);
      } else if (row.account_type === 'charge') {
        months[key].charges   += Number(row.total_debit) - Number(row.total_credit);
      } else if (row.account_type === 'tresorerie') {
        months[key].tresorerie += Number(row.total_debit) - Number(row.total_credit);
      }
    }

    return Object.values(months).map((m: any) => ({
      ...m,
      resultat: m.produits - m.charges,
    }));
  }
}
