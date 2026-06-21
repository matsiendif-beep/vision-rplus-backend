import { Injectable, Logger } from '@nestjs/common';
import { PrismaService }      from '../prisma/prisma.service';
import { WhatsAppAssistant }  from './whatsapp-assistant.service';

const WA_API_VERSION = 'v21.0';
const WA_BASE        = `https://graph.facebook.com/${WA_API_VERSION}`;

@Injectable()
export class WhatsAppService {
  private readonly logger = new Logger(WhatsAppService.name);

  constructor(
    private readonly prisma:     PrismaService,
    private readonly assistant:  WhatsAppAssistant,
  ) {}

  // ── Vérification webhook Meta ─────────────────────────────────
  verifyWebhook(mode: string, token: string, challenge: string): string | null {
    const verifyToken = process.env.WHATSAPP_VERIFY_TOKEN;
    if (mode === 'subscribe' && token === verifyToken) return challenge;
    return null;
  }

  // ── Traitement des messages entrants ─────────────────────────
  async handleInbound(body: any): Promise<void> {
    if (body.object !== 'whatsapp_business_account') return;

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        const value = change.value;
        if (!value?.messages) continue;

        for (const message of value.messages) {
          if (message.type !== 'text') {
            await this.sendText(message.from, '👋 Je comprends uniquement les messages texte pour l\'instant. Écris-moi ta question !');
            continue;
          }

          const phoneNumber = message.from;
          const text        = message.text.body;
          const waMessageId = message.id;

          this.logger.log(`Message reçu de ${phoneNumber}: "${text.slice(0, 60)}..."`);
          await this.processUserMessage(phoneNumber, text, waMessageId);
        }
      }
    }
  }

  // ── Traitement message utilisateur ───────────────────────────
  private async processUserMessage(
    phoneNumber: string,
    text:        string,
    waMessageId: string,
  ): Promise<void> {
    // Chercher ou créer une session
    let session = await this.prisma.whatsAppSession.findUnique({
      where:   { phone_number: phoneNumber },
      include: { user: true, company: true },
    });

    // Si aucune session trouvée → message d'accueil
    if (!session) {
      await this.sendText(phoneNumber,
        '👋 *Bienvenue sur Vision R+ !*\n\n' +
        'Je suis ton assistant comptable IA. Pour me connecter à ton compte, ' +
        'va sur *visionrplus.com > Paramètres > WhatsApp* et lie ton numéro.\n\n' +
        'Si tu n\'as pas encore de compte : www.visionrplus.com 🚀',
      );
      return;
    }

    // Enregistrer le message entrant
    await this.prisma.whatsAppMessage.create({
      data: {
        session_id:    session.id,
        direction:     'inbound',
        content:       text,
        wa_message_id: waMessageId,
      },
    });

    // Mettre à jour last_message_at
    await this.prisma.whatsAppSession.update({
      where: { id: session.id },
      data:  { last_message_at: new Date() },
    });

    // Générer et envoyer la réponse IA
    await this.sendText(phoneNumber, '⏳ _Je prépare ta réponse..._');

    const reply = await this.assistant.generateReply(session, text);

    // Enregistrer la réponse
    await this.prisma.whatsAppMessage.create({
      data: {
        session_id: session.id,
        direction:  'outbound',
        content:    reply,
      },
    });

    await this.sendText(phoneNumber, reply);
  }

  // ══════════════════════════════════════════════════════════════
  //  NOTIFICATIONS AUTOMATIQUES
  // ══════════════════════════════════════════════════════════════

  async notifyPaymentSuccess(userId: string, plan: string, amountEur: number): Promise<void> {
    const session = await this.getActiveSession(userId);
    if (!session) return;

    const planLabel = plan === 'pro' ? 'Pro' : 'Cabinet';
    const message =
      `✅ *Paiement confirmé — Vision R+ ${planLabel}*\n\n` +
      `Montant : *${amountEur}€/mois*\n` +
      `Ton abonnement est actif. Toutes les fonctionnalités sont débloquées 🎉\n\n` +
      `Connecte-toi sur www.visionrplus.com`;

    await this.sendAndLog(session, message);
  }

  async notifySubscriptionExpiring(userId: string, daysLeft: number): Promise<void> {
    const session = await this.getActiveSession(userId);
    if (!session) return;

    const message =
      `⚠️ *Vision R+ — Abonnement bientôt expiré*\n\n` +
      `Ton abonnement expire dans *${daysLeft} jour${daysLeft > 1 ? 's' : ''}*.\n` +
      `Pour continuer à accéder à toutes les fonctionnalités, renouvelle maintenant :\n` +
      `👉 www.visionrplus.com/settings/billing`;

    await this.sendAndLog(session, message);
  }

  async notifyJournalEntryValidated(
    userId:    string,
    reference: string,
    libelle:   string,
    amount:    number,
    currency:  string,
  ): Promise<void> {
    const session = await this.getActiveSession(userId);
    if (!session) return;

    const message =
      `📒 *Écriture validée — Vision R+*\n\n` +
      `Réf. : *${reference}*\n` +
      `Libellé : ${libelle}\n` +
      `Montant : *${amount.toLocaleString('fr-FR')} ${currency}*\n\n` +
      `Consulte ton journal sur www.visionrplus.com`;

    await this.sendAndLog(session, message);
  }

  async notifyFinancialAlert(
    userId:  string,
    type:    string,
    message: string,
  ): Promise<void> {
    const session = await this.getActiveSession(userId);
    if (!session) return;

    const icon = type === 'tresorerie_negative' ? '🔴' :
                 type === 'echeance_fiscale'    ? '📅' : '⚠️';

    const text =
      `${icon} *Alerte Vision R+*\n\n` +
      `${message}\n\n` +
      `Consulte ton tableau de bord : www.visionrplus.com`;

    await this.sendAndLog(session, text);
  }

  async notifyWelcome(userId: string, firstName: string): Promise<void> {
    const session = await this.getActiveSession(userId);
    if (!session) return;

    const message =
      `🎉 *Bienvenue sur Vision R+, ${firstName} !*\n\n` +
      `Ton numéro WhatsApp est maintenant lié à ton compte.\n\n` +
      `Je suis ton *assistant comptable IA*. Tu peux me poser des questions comme :\n` +
      `• _"Quel est mon chiffre d'affaires du mois ?"_\n` +
      `• _"Crée une écriture de vente de 500€"_\n` +
      `• _"Quelle est ma trésorerie disponible ?"_\n\n` +
      `Je suis disponible 24h/24 🤖`;

    await this.sendAndLog(session, message);
  }

  // ── Lier un numéro de téléphone à un compte ──────────────────
  async linkPhoneNumber(userId: string, phoneNumber: string, companyId?: string): Promise<void> {
    const normalized = this.normalizePhone(phoneNumber);

    await this.prisma.whatsAppSession.upsert({
      where:  { user_id: userId },
      create: {
        user_id:      userId,
        phone_number: normalized,
        company_id:   companyId ?? null,
        is_active:    true,
      },
      update: {
        phone_number: normalized,
        company_id:   companyId ?? null,
        is_active:    true,
      },
    });
  }

  async unlinkPhoneNumber(userId: string): Promise<void> {
    await this.prisma.whatsAppSession.updateMany({
      where: { user_id: userId },
      data:  { is_active: false },
    });
  }

  // ── Envoi message texte brut via WhatsApp Cloud API ──────────
  async sendText(to: string, text: string): Promise<void> {
    const phoneId = process.env.WHATSAPP_PHONE_ID;
    const token   = process.env.WHATSAPP_TOKEN;

    if (!phoneId || !token) {
      this.logger.warn('WHATSAPP_PHONE_ID ou WHATSAPP_TOKEN manquant — envoi ignoré');
      return;
    }

    const res = await fetch(`${WA_BASE}/${phoneId}/messages`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text },
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      this.logger.error('Erreur envoi WhatsApp', JSON.stringify(err));
    } else {
      this.logger.log(`Message envoyé à ${to}`);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────
  private async getActiveSession(userId: string) {
    return this.prisma.whatsAppSession.findFirst({
      where:   { user_id: userId, is_active: true },
      include: { user: true, company: true },
    });
  }

  private async sendAndLog(session: any, message: string): Promise<void> {
    await this.sendText(session.phone_number, message);
    await this.prisma.whatsAppMessage.create({
      data: {
        session_id: session.id,
        direction:  'outbound',
        content:    message,
      },
    });
  }

  private normalizePhone(phone: string): string {
    // Normalise vers format E.164 international sans +
    return phone.replace(/\D/g, '');
  }
}
