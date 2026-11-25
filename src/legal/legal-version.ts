// ── legal/legal-version.ts ───────────────────────────────────
//  Version en vigueur des documents juridiques (CGU/CGV + politique
//  de confidentialité). À chaque modification des textes côté site
//  (vision-rplus-frontend/src/app/legal), changez cette date ET
//  LEGAL_VERSION côté frontend : les utilisateurs existants devront
//  accepter la nouvelle version à leur prochaine visite.
// ─────────────────────────────────────────────────────────────
export const LEGAL_VERSION = '2026-11-25';

/** Action enregistrée dans audit_logs à chaque acceptation (preuve). */
export const LEGAL_ACCEPTED_ACTION = 'legal.accepted';
