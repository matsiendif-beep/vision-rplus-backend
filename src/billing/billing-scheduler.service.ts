// ════════════════════════════════════════════════════════════
//  Tâches périodiques de facturation (toutes les heures)
//   • Mobile Money : rappel 3 jours avant la fin des 30 jours,
//     puis fin de l'accès payant à l'échéance (retour au Gratuit,
//     données conservées) — CGV art. 6.
//  Les abonnements par carte sont gérés par les webhooks Stripe.
// ════════════════════════════════════════════════════════════
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BillingService } from './billing.service';
import { OnboardingEmailsService } from '../email/onboarding-emails.service';

const HOUR = 3_600_000;
const DAY  = 24 * HOUR;

@Injectable()
export class BillingSchedulerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Facturation');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private billing: BillingService,
    private emails: OnboardingEmailsService,
  ) {}

  onModuleInit() {
    setTimeout(() => this.run(), 90_000).unref();
    this.timer = setInterval(() => this.run(), HOUR);
    this.timer.unref();
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  async run() {
    if (this.running) return;
    this.running = true;
    try {
      const now = new Date();
      const mobileMoney = { stripe_sub_id: null, status: 'actif' as const };

      // Rappel J-3
      const ending = await this.prisma.subscription.findMany({
        where: { ...mobileMoney, current_period_end: { gt: now, lte: new Date(now.getTime() + 3 * DAY) } },
      });
      for (const s of ending) await this.emails.sendMobileMoneyEnding(s.user_id, s.plan, s.current_period_end!, s.id);

      // Échéance dépassée → fin de l'accès payant
      const expired = await this.prisma.subscription.findMany({
        where: { ...mobileMoney, current_period_end: { lte: now } },
      });
      for (const s of expired) {
        await this.prisma.subscription.update({ where: { id: s.id }, data: { status: 'expire' } });
        await this.billing.downgradeIfNoActiveSubscription(s.user_id);
        this.logger.log(`Mobile Money arrivé à échéance : ${s.user_id} (${s.plan})`);
      }
    } catch (e: any) {
      this.logger.error(`Tâche de facturation : ${e.message}`);
    } finally {
      this.running = false;
    }
  }
}
