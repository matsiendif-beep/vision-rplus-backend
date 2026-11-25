// ════════════════════════════════════════════════════════════
//  Plans comptables de référence + règles de classement
//  (source unique, utilisée par la synchronisation au démarrage,
//   la création de sous-comptes et les états financiers)
// ════════════════════════════════════════════════════════════
import { PCG_2026 } from './pcg-2026';
import { SYSCOHADA_REVISE } from './syscohada-revise';

export type PlanSystem = 'ohada' | 'pcg_france';
export type PlanAccountType = 'actif' | 'passif' | 'charge' | 'produit' | 'tresorerie' | 'analytique';

export const REFERENCE_PLANS: Record<PlanSystem, ReadonlyArray<readonly [string, string]>> = {
  ohada:      SYSCOHADA_REVISE,
  pcg_france: PCG_2026,
};

/** Classes autorisées par plan (PCG : 1 à 7 ; SYSCOHADA : 1 à 9). */
export const ALLOWED_CLASSES: Record<PlanSystem, string[]> = {
  ohada:      ['1', '2', '3', '4', '5', '6', '7', '8', '9'],
  pcg_france: ['1', '2', '3', '4', '5', '6', '7'],
};

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** SYSCOHADA, classe 8 : comptes impairs (81, 83, 85, 87, 89) = charges HAO / impôt ;
 *  comptes pairs (82, 84, 86, 88) = produits HAO. */
export const isOhadaClass8Charge = (code: string) => ['1', '3', '5', '7', '9'].includes(code[1]);

/** Type d'un compte déduit de sa classe (et, pour les tiers, de sa nature). */
export function accountTypeFor(system: PlanSystem, code: string, label = ''): PlanAccountType {
  switch (code[0]) {
    case '1': return 'passif';
    case '2':
    case '3': return 'actif';
    case '5': return 'tresorerie';
    case '6': return 'charge';
    case '7': return 'produit';
    case '8': return system === 'ohada' && isOhadaClass8Charge(code) ? 'charge' : 'produit';
    case '9': return 'analytique';
    case '4': {
      // Comptes de tiers : actif (créance) ou passif (dette) selon leur nature
      const l = norm(label);
      if (/debiteur/.test(l)) return 'actif';
      if (/crediteur|avances recues|acomptes recus|avances et acomptes recus/.test(l)) return 'passif';
      if (/deductible|recuperable|a recevoir|charges constatees|creance|avances et acomptes|acomptes verses|credit de t\.?v\.?a|client|depreciation|ecarts? de conversion.{0,3}actif|- actif/.test(l)) return 'actif';
      if (/^4[19]/.test(code) && !/^419/.test(code)) return 'actif'; // 41 clients, 49 dépréciations
      return 'passif';
    }
    default: return 'analytique';
  }
}

/** Compte mouvementable (utilisable en saisie) : 3 chiffres et plus.
 *  Les comptes à 2 chiffres sont des regroupements (ex. 60 Achats). */
export const isPostable = (code: string) => code.length >= 3;

/** Ressemblance entre deux libellés (0 à 1), pour distinguer une simple
 *  différence d'écriture d'un changement de sens. */
export function labelSimilarity(a: string, b: string): number {
  const STOP = new Set(['de', 'des', 'du', 'la', 'le', 'les', 'et', 'en', 'a', 'au', 'aux', 'sur', 'par', 'l', 'd', 'pour', 'ou']);
  // Mots normalisés, pluriels ramenés au singulier (banques → banque, travaux → travau)
  const words = (s: string) => new Set(norm(s).replace(/[^a-z0-9]+/g, ' ').split(' ')
    .filter((w) => w.length > 1 && !STOP.has(w))
    .map((w) => (w.length > 3 && /[sx]$/.test(w) ? w.slice(0, -1) : w)));
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}
