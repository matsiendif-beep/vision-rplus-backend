// ════════════════════════════════════════════════════════════
//  Notifications (cloche en haut de chaque page)
//  Calculées à la demande, chacune avec un lien vers la page
//  où agir. Rien n'est stocké : une notification disparaît
//  d'elle-même quand la situation est réglée.
// ════════════════════════════════════════════════════════════
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';
import { ReclassificationService } from '../accounts/reclassification.service';
import { PlanLimitsService } from '../common/plan/plan-limits.service';

export interface AppNotification {
  id:       string;
  severity: 'critique' | 'attention' | 'info';
  title:    string;
  message:  string;
  href:     string;
}

const DAY = 864e5;
const fmt = (d: Date) => d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' });

@Injectable()
export class NotificationsService {
  constructor(
    private prisma: PrismaService,
    private analytics: AnalyticsService,
    private reclass: ReclassificationService,
    private limits: PlanLimitsService,
  ) {}

  async list(companyId: string, fiscalYearId: string | undefined, userId: string): Promise<AppNotification[]> {
    const out: AppNotification[] = [];

    // 1. Alertes financières de l'exercice
    if (fiscalYearId) {
      for (const a of await this.analytics.computeFinancialAlerts(companyId, fiscalYearId)) {
        out.push({ id: `fin-${a.type}`, severity: a.severity, title: 'Alerte financière', message: a.message, href: '/dashboard' });
      }
    }

    // 2. Écritures en brouillon (non prises en compte dans les états)
    const drafts = await this.prisma.journalEntry.count({
      where: { company_id: companyId, status: 'brouillon', ...(fiscalYearId ? { fiscal_year_id: fiscalYearId } : {}) },
    });
    if (drafts) {
      out.push({
        id: 'drafts', severity: 'attention', title: `${drafts} écriture${drafts > 1 ? 's' : ''} en brouillon`,
        message: 'Les brouillons ne sont pas repris dans le bilan ni le compte de résultat : validez-les.', href: '/journal',
      });
    }

    // 3. Comptes à reclasser (ancien plan comptable)
    const legacy = await this.reclass.legacyUsage(companyId);
    if (legacy.length) {
      out.push({
        id: 'reclass', severity: 'attention', title: 'Écritures à reclasser',
        message: `Compte${legacy.length > 1 ? 's' : ''} ${legacy.map((l) => l.code).join(', ')} : libellé corrigé par la mise en conformité du plan comptable.`,
        href: '/plan-comptable',
      });
    }

    // 4. Quota du plan Gratuit
    const usage = await this.limits.entryUsage(companyId);
    if (usage.limited && usage.used >= 8) {
      out.push({
        id: 'quota', severity: usage.remaining === 0 ? 'critique' : 'info',
        title: usage.remaining === 0 ? 'Limite d\'écritures atteinte' : `Plus que ${usage.remaining} écriture${usage.remaining > 1 ? 's' : ''} ce mois-ci`,
        message: 'Plan Gratuit : 10 écritures par mois. Le plan Pro les rend illimitées.', href: '/abonnement',
      });
    }

    // 5. Abonnement
    const sub = await this.prisma.subscription.findFirst({
      where: { user_id: userId, status: { in: ['essai', 'actif', 'expire'] } },
      orderBy: { created_at: 'desc' },
    });
    const now = Date.now();
    if (sub?.status === 'expire' && sub.stripe_sub_id) {
      out.push({ id: 'sub-failed', severity: 'critique', title: 'Paiement de l\'abonnement en échec', message: 'Mettez à jour votre carte pour conserver votre formule.', href: '/abonnement' });
    } else if (sub?.status === 'essai' && sub.trial_ends_at && sub.trial_ends_at.getTime() - now < 3 * DAY) {
      out.push({ id: 'sub-trial', severity: 'info', title: `Essai gratuit jusqu'au ${fmt(sub.trial_ends_at)}`, message: 'Votre abonnement démarrera ensuite automatiquement.', href: '/abonnement' });
    } else if (sub?.status === 'actif' && !sub.stripe_sub_id && sub.current_period_end && sub.current_period_end.getTime() - now < 3 * DAY) {
      out.push({ id: 'sub-momo', severity: 'attention', title: `Accès Mobile Money jusqu'au ${fmt(sub.current_period_end)}`, message: 'Pas de renouvellement automatique : renouvelez pour continuer.', href: '/abonnement' });
    }

    const rank = { critique: 0, attention: 1, info: 2 };
    return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
  }
}
