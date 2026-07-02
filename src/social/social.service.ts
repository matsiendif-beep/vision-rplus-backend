import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';

@Injectable()
export class SocialService {
  private readonly logger = new Logger(SocialService.name);
  private readonly client: Anthropic | null;

  constructor() {
    const key = process.env.ANTHROPIC_API_KEY;
    this.client = key ? new Anthropic({ apiKey: key }) : null;
    if (!key) this.logger.warn('ANTHROPIC_API_KEY non défini — réponses IA désactivées');
  }

  // ── Prompt système commun ─────────────────────────────────────
  private readonly SYSTEM_PROMPT = `Tu es l'assistant commercial de Vision R+, un logiciel de comptabilité SaaS
pour PME françaises (PCG France) et africaines (OHADA).

Ton rôle : répondre aux messages entrants sur Facebook et Instagram de manière chaleureuse,
professionnelle et commerciale. Tu dois aider, convertir en essai, et orienter vers le bon endroit.

Règles :
- Réponds en 2-4 phrases maximum (c'est un DM, pas un email)
- Sois chaleureux et personnel (utilise le prénom si disponible)
- Si la personne est intéressée → donne le lien : www.visionrplus.com
- Si c'est une question technique → réponds brièvement et propose un essai gratuit
- Si c'est une plainte ou un problème → empathie + solution immédiate
- Si tu ne sais pas → dis-le honnêtement et propose de contacter l'équipe
- Ne promets jamais quelque chose que tu ne peux pas garantir
- Langue : français (adapte-toi si l'utilisateur écrit en anglais)`;

  // ── Réponse ManyChat ──────────────────────────────────────────
  async generateReply(
    message: string,
    firstName: string,
    intent?: string,
  ): Promise<string> {
    // Réponses prédéfinies pour les intents courants (plus rapide et sans API call)
    const quickReplies = this.getQuickReply(intent, firstName);
    if (quickReplies) return quickReplies;

    if (!this.client) return this.fallbackReply(firstName);
    try {
      const response = await this.client.messages.create({
        model:      'claude-haiku-4-5-20251001', // Modèle rapide pour les webhooks
        max_tokens: 250,
        system:     this.SYSTEM_PROMPT,
        messages: [{
          role:    'user',
          content: `Prénom de l'utilisateur : ${firstName}
Message reçu : "${message}"
${intent ? `Intention détectée : ${intent}` : ''}

Génère UNE réponse courte et engageante (2-4 phrases max).`,
        }],
      });
      return response.content[0].type === 'text' ? response.content[0].text : this.fallbackReply(firstName);
    } catch (err) {
      this.logger.warn(`Claude API indisponible, réponse fallback envoyée: ${err?.message}`);
      return this.fallbackReply(firstName);
    }
  }

  // ── Réponses rapides par intent ───────────────────────────────
  // Ces réponses sont envoyées instantanément sans appel API
  private getQuickReply(intent: string | undefined, firstName: string): string | null {
    const name = firstName ?? 'ami(e)';

    const replies: Record<string, string> = {
      'prix':        `Bonjour ${name} ! Vision R+ est conçu pour être accessible aux PME. Crée ton compte gratuitement sur www.visionrplus.com et découvre toutes les fonctionnalités. Si tu as des questions sur les tarifs, envoie-nous un message direct 😊`,
      'essai':       `Super ${name} ! Tu peux commencer tout de suite sur www.visionrplus.com — aucune carte bancaire requise pour commencer. Crée ton premier exercice comptable en 2 minutes !`,
      'demo':        `Bonjour ${name} ! Pour une démo personnalisée de Vision R+, tu peux tester directement sur www.visionrplus.com. Toutes les fonctionnalités (journal, bilan, compte de résultat, FEC) sont accessibles. Dis-nous si tu as des questions ! 🎯`,
      'ohada':       `Bonjour ${name} ! Vision R+ supporte à la fois PCG France et OHADA — tu peux gérer des entreprises françaises ET africaines dans le même logiciel. Essaie ici : www.visionrplus.com 🌍`,
      'aide':        `Bonjour ${name} ! On est là pour t'aider 😊 Décris-nous ta situation et on te guide pas à pas. Tu peux aussi tester Vision R+ directement sur www.visionrplus.com — l'interface est simple et intuitive !`,
      'merci':       `Merci à toi ${name} ! 🙏 Si Vision R+ t'a aidé, n'hésite pas à en parler autour de toi — chaque entrepreneur mérite une compta claire. À bientôt !`,
      'inscription': `Parfait ${name} ! Pour créer ton compte Vision R+, va sur www.visionrplus.com → "Créer un compte". C'est rapide et tu peux commencer à saisir tes écritures de suite. Bienvenue dans la famille Vision R+ 🎉`,
    };

    return replies[intent ?? ''] ?? null;
  }

  // ── Traitement événements Meta ────────────────────────────────
  async processMetaEvent(body: any): Promise<void> {
    if (body.object !== 'page' && body.object !== 'instagram') return;

    for (const entry of body.entry ?? []) {
      for (const messaging of entry.messaging ?? []) {
        if (!messaging.message?.text) continue;

        const senderId = messaging.sender.id;
        const text     = messaging.message.text;

        this.logger.log(`Message Meta reçu de ${senderId}: "${text.slice(0, 50)}..."`);

        const reply = await this.generateReply(text, 'ami(e)');
        await this.sendMetaMessage(senderId, reply);
      }
    }
  }

  // ── Envoi réponse via Meta Graph API ─────────────────────────
  private async sendMetaMessage(recipientId: string, text: string): Promise<void> {
    const pageId    = process.env.FB_PAGE_ID;
    const token     = process.env.FB_PAGE_ACCESS_TOKEN;
    const apiVersion = 'v21.0';

    if (!pageId || !token) {
      this.logger.warn('FB_PAGE_ID ou FB_PAGE_ACCESS_TOKEN manquant — envoi ignoré');
      return;
    }

    const res = await fetch(`https://graph.facebook.com/${apiVersion}/me/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        recipient:    { id: recipientId },
        message:      { text },
        access_token: token,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      this.logger.error('Erreur envoi Meta message', err);
    } else {
      this.logger.log(`Réponse envoyée à ${recipientId}`);
    }
  }

  private fallbackReply(firstName: string): string {
    return `Bonjour ${firstName} ! Merci pour ton message 😊 Notre équipe Vision R+ te répond très bientôt. En attendant, tu peux explorer le logiciel sur www.visionrplus.com !`;
  }
}
