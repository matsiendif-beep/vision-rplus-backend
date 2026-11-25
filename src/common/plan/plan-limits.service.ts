// ── common/plan/plan-limits.service.ts ───────────────────────
//  Limites des formules (source unique, reprise par les CGV) :
//    Gratuit : 1 entreprise, 10 écritures par mois (toutes fonctions)
//    Pro     : 3 entreprises, écritures illimitées
//    Cabinet : 10 entreprises incluses (+5 €/mois par entreprise
//              supplémentaire, sur demande), écritures illimitées
//  L'entreprise de démonstration n'est jamais comptée ni limitée.
// ─────────────────────────────────────────────────────────────
import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DEMO_MARKER }   from '../../companies/demo-company';

export const FREE_MONTHLY_ENTRIES = 10;
export const COMPANY_LIMITS: Record<string, number> = { free: 1, pro: 3, cabinet: 10 };
export const CABINET_EXTRA_COMPANY = { EUR: 5, XAF: 3000, XOF: 3000 };

@Injectable()
export class PlanLimitsService {
  constructor(private prisma: PrismaService) {}

  /** Début du mois civil en cours (UTC). */
  private monthStart(now = new Date()) {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  }

  /** Écritures déjà créées ce mois-ci par le propriétaire de l'entreprise
   *  (toutes ses entreprises hors démo), et quota restant. */
  async entryUsage(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where:  { id: companyId },
      select: { owner_id: true, rccm: true, owner: { select: { plan: true } } },
    });
    if (!company) return { limited: false, used: 0, remaining: Infinity };
    if (company.rccm === DEMO_MARKER || company.owner.plan !== 'free') {
      return { limited: false, used: 0, remaining: Infinity };
    }
    const owned = await this.prisma.company.findMany({
      where:  { owner_id: company.owner_id },
      select: { id: true, rccm: true },
    });
    const ids = owned.filter((c) => c.rccm !== DEMO_MARKER).map((c) => c.id);
    const used = await this.prisma.journalEntry.count({
      where: { company_id: { in: ids }, created_at: { gte: this.monthStart() } },
    });
    return { limited: true, used, remaining: Math.max(0, FREE_MONTHLY_ENTRIES - used) };
  }

  /** Bloque si la création de `count` écritures dépasse le quota du plan Gratuit. */
  async assertCanCreateEntries(companyId: string, count = 1) {
    const usage = await this.entryUsage(companyId);
    if (!usage.limited || count <= usage.remaining) return;
    const detail = count > 1
      ? `Cet import contient ${count} écritures, il vous en reste ${usage.remaining} ce mois-ci.`
      : `Vous avez déjà enregistré ${usage.used} écritures ce mois-ci.`;
    throw new ForbiddenException(
      `Plan Gratuit : ${FREE_MONTHLY_ENTRIES} écritures par mois. ${detail} ` +
      `Passez au plan Pro pour des écritures illimitées (14 jours d'essai gratuit).`,
    );
  }
}
