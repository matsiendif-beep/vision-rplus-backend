// ── email/onboarding-emails.service.ts ───────────────────────
//  Séquence d'emails automatiques :
//    J0   welcome      — à l'inscription
//    J+1  activation   — si aucune écriture dans une vraie entreprise
//    J+3  help         — idem, proposition de démo personnalisée
//    J-3  trial_ending — avant la fin de l'essai Stripe
//    ---  subscribed   — après souscription (webhook Stripe)
//  Chaque envoi est tracé dans audit_logs (action "email.<clé>")
//  pour ne jamais envoyer deux fois le même email.
//  Le planificateur tourne toutes les heures dans le process.
// ─────────────────────────────────────────────────────────────
import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService }  from './email.service';
import { DEMO_MARKER }   from '../companies/demo-company';
import * as T from './templates';

type EmailKey = 'welcome' | 'activation' | 'help' | 'trial_ending' | 'subscribed';

const HOUR = 3_600_000;
const DAY  = 24 * HOUR;
const UNSUBSCRIBED = 'email.unsubscribed';

interface Recipient { id: string; email: string; first_name: string }

@Injectable()
export class OnboardingEmailsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OnboardingEmailsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private email:  EmailService,
  ) {}

  // ── Planificateur ──────────────────────────────────────────
  onModuleInit() {
    if (!this.email.enabled || process.env.EMAIL_SEQUENCE_DISABLED === 'true') {
      this.logger.warn('Séquence d\'emails désactivée (BREVO_API_KEY absent ou EMAIL_SEQUENCE_DISABLED=true)');
      return;
    }
    // Premier passage 2 min après le démarrage, puis toutes les heures
    setTimeout(() => this.runSequence(), 2 * 60_000).unref();
    this.timer = setInterval(() => this.runSequence(), HOUR);
    this.timer.unref();
    this.logger.log('Séquence d\'emails d\'onboarding active (toutes les heures)');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async runSequence() {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      // J+1 : inscrits il y a 1 à 7 jours, sans écriture réelle
      for (const u of await this.inactiveUsers(now - 7 * DAY, now - 1 * DAY)) {
        await this.sendOnce(u, 'activation', (ctx) => T.activation(ctx));
      }
      // J+3 : inscrits il y a 3 à 10 jours, toujours sans écriture réelle
      //       (au moins 2 jours après l'email J+1, pour ne pas envoyer les deux d'un coup)
      for (const u of await this.inactiveUsers(now - 10 * DAY, now - 3 * DAY)) {
        const prev = await this.prisma.auditLog.findFirst({
          where:  { user_id: u.id, action: 'email.activation' },
          select: { created_at: true },
        });
        if (!prev || prev.created_at.getTime() > now - 2 * DAY) continue;
        await this.sendOnce(u, 'help', (ctx) => T.help(ctx));
      }
      // J-3 : fin d'essai dans les 3 prochains jours
      const trials = await this.prisma.subscription.findMany({
        where: {
          status:        'essai',
          trial_ends_at: { gte: new Date(now), lte: new Date(now + 3 * DAY) },
        },
        include: { user: { select: { id: true, email: true, first_name: true, is_active: true } } },
      });
      for (const s of trials) {
        if (!s.user.is_active || !s.trial_ends_at) continue;
        await this.sendOnce(s.user, 'trial_ending', (ctx) => T.trialEnding(ctx, s.trial_ends_at!), s.id);
      }
    } catch (e: any) {
      this.logger.error(`Erreur séquence emails : ${e.message}`);
    } finally {
      this.running = false;
    }
  }

  // ── Déclencheurs directs ───────────────────────────────────
  sendWelcome(user: Recipient) {
    // Ne bloque jamais l'inscription
    this.sendOnce(user, 'welcome', (ctx) => T.welcome(ctx))
      .catch((e) => this.logger.error(`Email de bienvenue : ${e.message}`));
  }

  async sendSubscribed(userId: string, plan: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }, select: { id: true, email: true, first_name: true },
    });
    if (!user) return;
    const label = plan === 'cabinet' ? 'Cabinet' : plan === 'pro' ? 'Pro' : plan;
    await this.sendOnce(user, 'subscribed', (ctx) => T.subscribed(ctx, label), plan);
  }

  // ── Désinscription ─────────────────────────────────────────
  unsubscribeToken(userId: string): string {
    const secret = process.env.JWT_SECRET ?? 'visionrplus';
    return createHmac('sha256', secret).update(`unsubscribe:${userId}`).digest('hex').slice(0, 32);
  }

  async unsubscribe(userId: string, token: string): Promise<boolean> {
    const expected = Buffer.from(this.unsubscribeToken(userId));
    const given    = Buffer.from(token ?? '');
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) return false;
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) return false;
    if (!(await this.hasLog(userId, UNSUBSCRIBED))) {
      await this.prisma.auditLog.create({ data: { user_id: userId, action: UNSUBSCRIBED } });
    }
    return true;
  }

  // ── Internes ───────────────────────────────────────────────
  /** Utilisateurs inscrits dans la fenêtre, sans écriture hors entreprise démo. */
  private async inactiveUsers(from: number, to: number): Promise<Recipient[]> {
    const users = await this.prisma.user.findMany({
      where:  { is_active: true, created_at: { gte: new Date(from), lte: new Date(to) } },
      select: {
        id: true, email: true, first_name: true,
        owned_companies: {
          select: { rccm: true, _count: { select: { journal_entries: true } } },
        },
      },
      take: 500,
    });
    return users.filter((u) =>
      !u.owned_companies.some((c) => c.rccm !== DEMO_MARKER && c._count.journal_entries > 0),
    );
  }

  private async hasLog(userId: string, action: string, recordId?: string) {
    const found = await this.prisma.auditLog.findFirst({
      where:  { user_id: userId, action, ...(recordId ? { record_id: recordId } : {}) },
      select: { id: true },
    });
    return !!found;
  }

  private async sendOnce(
    user:     Recipient,
    key:      EmailKey,
    render:   (ctx: T.TemplateContext) => T.RenderedEmail,
    recordId?: string,
  ) {
    const action = `email.${key}`;
    if (await this.hasLog(user.id, action, recordId)) return;
    // L'email "subscribed" est transactionnel : envoyé même après désinscription des conseils
    if (key !== 'subscribed' && (await this.hasLog(user.id, UNSUBSCRIBED))) return;

    const appUrl = (process.env.APP_URL ?? 'https://www.visionrplus.com').replace(/\/$/, '');
    const ctx: T.TemplateContext = {
      firstName:      user.first_name || 'et bienvenue',
      appUrl,
      bookingUrl:     process.env.DEMO_BOOKING_URL || undefined,
      unsubscribeUrl: `${appUrl}/api/v1/email/unsubscribe?u=${user.id}&t=${this.unsubscribeToken(user.id)}`,
    };
    const mail = render(ctx);
    const ok = await this.email.send({
      to:      { email: user.email, name: user.first_name },
      subject: mail.subject,
      html:    mail.html,
      text:    mail.text,
      tags:    ['onboarding', key],
    });
    if (ok) {
      await this.prisma.auditLog.create({
        data: { user_id: user.id, action, table_name: 'email', record_id: recordId },
      });
      this.logger.log(`Email "${key}" envoyé à ${user.email}`);
    }
  }
}
