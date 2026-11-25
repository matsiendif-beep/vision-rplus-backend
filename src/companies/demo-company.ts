// ── companies/demo-company.ts ────────────────────────────────
//  Données de l'entreprise de démonstration (onboarding).
//  Une PME gabonaise fictive sous SYSCOHADA, avec une année
//  d'écritures réalistes pour que le nouvel utilisateur voie
//  tout de suite un bilan, un compte de résultat et des KPI.
// ─────────────────────────────────────────────────────────────

/** Marqueur stocké dans `rccm` pour reconnaître l'entreprise démo
 *  (évite une migration de schéma). */
export const DEMO_MARKER = 'DEMO-VISIONRPLUS';

export const DEMO_COMPANY = {
  name:              'Boutique Akanda SARL (démo)',
  legal_form:        'SARL',
  accounting_system: 'ohada' as const,
  currency:          'XAF' as const,
  country:           'Gabon',
  city:              'Libreville',
  rccm:              DEMO_MARKER,
};

/** Rôles comptables utilisés par la démo. Pour chaque rôle, on prend le
 *  premier compte système OHADA qui existe (code + mot-clé du libellé),
 *  car le plan chargé en base peut différer selon l'historique des seeds. */
export const DEMO_ACCOUNT_ROLES = {
  capital:       [{ code: '1013' }, { code: '101', label: /capital/i }],
  emprunt:       [{ code: '162', label: /cr[ée]dit/i }, { code: '162' }, { code: '16' }],
  materiel:      [{ code: '2442', label: /informatique/i }, { code: '244', label: /informatique/i }, { code: '245', label: /informatique/i }, { code: '2441' }, { code: '244' }],
  fournisseurs:  [{ code: '401' }, { code: '4011' }],
  clients:       [{ code: '411' }, { code: '4111' }],
  tva_collectee: [{ code: '4431' }, { code: '4414' }, { code: '443', label: /TVA/i }],
  tva_deduct:    [{ code: '4452' }, { code: '4415' }, { code: '445', label: /TVA/i }],
  banque:        [{ code: '521' }, { code: '5211' }],
  achats:        [{ code: '601' }, { code: '6011' }],
  loyer:         [{ code: '622', label: /location/i }, { code: '6222', label: /location|loyer/i }, { code: '6221', label: /loyer/i }],
  publicite:     [{ code: '627' }],
  telecom:       [{ code: '628', label: /t[ée]l[ée]com/i }, { code: '6281' }, { code: '628' }],
  interets:      [{ code: '671', label: /int[ée]r[êe]t/i }, { code: '6711' }, { code: '6611', label: /int[ée]r[êe]t/i }],
  ventes:        [{ code: '701' }, { code: '7011' }],
} satisfies Record<string, Array<{ code: string; label?: RegExp }>>;

export type DemoRole = keyof typeof DEMO_ACCOUNT_ROLES;

/** Résout chaque rôle vers l'id d'un compte existant ; renvoie aussi les rôles introuvables. */
export function resolveDemoAccounts(accounts: Array<{ id: string; code: string; label: string }>) {
  const ids = new Map<DemoRole, string>();
  const missing: DemoRole[] = [];
  for (const [role, candidates] of Object.entries(DEMO_ACCOUNT_ROLES) as [DemoRole, Array<{ code: string; label?: RegExp }>][]) {
    const hit = candidates
      .map((c) => accounts.find((a) => a.code === c.code && (!c.label || c.label.test(a.label))))
      .find(Boolean);
    if (hit) ids.set(role, hit.id); else missing.push(role);
  }
  return { ids, missing };
}

export const DEMO_ACCOUNT_CODES = [...new Set(
  Object.values(DEMO_ACCOUNT_ROLES).flatMap((cs) => cs.map((c) => c.code)),
)];

type Code = DemoRole;
type Journal = 'achats' | 'ventes' | 'banque' | 'caisse' | 'od';

export interface DemoEntry {
  date:    Date;
  journal: Journal;
  ref:     string;
  libelle: string;
  lines:   Array<{ code: Code; debit?: number; credit?: number; libelle?: string }>;
}

const TVA = 0.18; // TVA Gabon
// Variation mensuelle déterministe du chiffre d'affaires (saisonnalité)
const SEASON = [0.82, 0.78, 0.9, 0.95, 1.0, 0.92, 0.88, 0.85, 1.05, 1.1, 1.18, 1.35];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
                'août', 'septembre', 'octobre', 'novembre', 'décembre'];

const round = (n: number) => Math.round(n / 1000) * 1000;

/** Génère les écritures de l'année `year`, jusqu'à `today` inclus. */
export function buildDemoEntries(year: number, today: Date): DemoEntry[] {
  const entries: DemoEntry[] = [];
  const d = (m: number, day: number) => new Date(Date.UTC(year, m, day, 12));
  let n = 0;
  const ref = (p: string) => `${p}-${String(++n).padStart(3, '0')}`;

  // ── Ouverture : apport en capital + emprunt + investissement
  entries.push({
    date: d(0, 2), journal: 'banque', ref: ref('BQ'), libelle: 'Apport en capital des associés',
    lines: [{ code: 'banque', debit: 10_000_000 }, { code: 'capital', credit: 10_000_000 }],
  });
  entries.push({
    date: d(0, 3), journal: 'banque', ref: ref('BQ'), libelle: 'Déblocage emprunt BGFIBank',
    lines: [{ code: 'banque', debit: 5_000_000 }, { code: 'emprunt', credit: 5_000_000 }],
  });
  entries.push({
    date: d(0, 10), journal: 'banque', ref: ref('BQ'), libelle: 'Achat ordinateurs et caisse enregistreuse',
    lines: [{ code: 'materiel', debit: 2_400_000 }, { code: 'banque', credit: 2_400_000 }],
  });

  // ── Activité mensuelle
  for (let m = 0; m < 12; m++) {
    const mois = MONTHS[m];
    const ventesHT  = round(5_200_000 * SEASON[m]);
    const ventesTVA = round(ventesHT * TVA);
    const achatsHT  = round(ventesHT * 0.56);
    const achatsTVA = round(achatsHT * TVA);

    entries.push({
      date: d(m, 6), journal: 'achats', ref: ref('AC'), libelle: `Achats marchandises — ${mois}`,
      lines: [
        { code: 'achats',  debit: achatsHT },
        { code: 'tva_deduct', debit: achatsTVA },
        { code: 'fournisseurs',  credit: achatsHT + achatsTVA },
      ],
    });
    entries.push({
      date: d(m, 8), journal: 'banque', ref: ref('BQ'), libelle: `Loyer boutique — ${mois}`,
      lines: [{ code: 'loyer', debit: 450_000 }, { code: 'banque', credit: 450_000 }],
    });
    entries.push({
      date: d(m, 12), journal: 'banque', ref: ref('BQ'), libelle: `Internet et téléphone — ${mois}`,
      lines: [{ code: 'telecom', debit: 85_000 }, { code: 'banque', credit: 85_000 }],
    });
    if (m % 3 === 2) {
      entries.push({
        date: d(m, 14), journal: 'banque', ref: ref('BQ'), libelle: `Campagne publicitaire réseaux sociaux`,
        lines: [{ code: 'publicite', debit: 180_000 }, { code: 'banque', credit: 180_000 }],
      });
    }
    entries.push({
      date: d(m, 20), journal: 'ventes', ref: ref('VT'), libelle: `Ventes du mois — ${mois}`,
      lines: [
        { code: 'clients',  debit: ventesHT + ventesTVA },
        { code: 'ventes',  credit: ventesHT },
        { code: 'tva_collectee', credit: ventesTVA },
      ],
    });
    entries.push({
      date: d(m, 24), journal: 'banque', ref: ref('BQ'), libelle: `Règlement fournisseurs — ${mois}`,
      lines: [{ code: 'fournisseurs', debit: round((achatsHT + achatsTVA) * 0.9) }, { code: 'banque', credit: round((achatsHT + achatsTVA) * 0.9) }],
    });
    entries.push({
      date: d(m, 26), journal: 'banque', ref: ref('BQ'), libelle: `Encaissements clients — ${mois}`,
      lines: [{ code: 'banque', debit: round((ventesHT + ventesTVA) * 0.85) }, { code: 'clients', credit: round((ventesHT + ventesTVA) * 0.85) }],
    });
    entries.push({
      date: d(m, 28), journal: 'banque', ref: ref('BQ'), libelle: `Intérêts emprunt — ${mois}`,
      lines: [{ code: 'interets', debit: 40_000 }, { code: 'banque', credit: 40_000 }],
    });
  }

  return entries.filter((e) => e.date.getTime() <= today.getTime());
}
