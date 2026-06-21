import { Injectable, Logger } from '@nestjs/common';
import Anthropic              from '@anthropic-ai/sdk';
import { PrismaService }      from '../prisma/prisma.service';

@Injectable()
export class WhatsAppAssistant {
  private readonly logger = new Logger(WhatsAppAssistant.name);
  private readonly claude  = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  constructor(private readonly prisma: PrismaService) {}

  async generateReply(session: any, userMessage: string): Promise<string> {
    try {
      // Charger le contexte financier de la company liée
      const context = session.company_id
        ? await this.buildFinancialContext(session.company_id)
        : null;

      const systemPrompt = this.buildSystemPrompt(session.user, session.company, context);

      // Charger l'historique récent (10 derniers messages)
      const history = await this.prisma.whatsAppMessage.findMany({
        where:   { session_id: session.id },
        orderBy: { created_at: 'desc' },
        take:    10,
      });

      const messages: Anthropic.MessageParam[] = history
        .reverse()
        .map(m => ({
          role:    m.direction === 'inbound' ? 'user' : 'assistant',
          content: m.content,
        }));

      // Ajouter le message actuel
      messages.push({ role: 'user', content: userMessage });

      const response = await this.claude.messages.create({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 400,
        system:     systemPrompt,
        messages,
      });

      return response.content[0].type === 'text'
        ? response.content[0].text
        : this.fallback(session.user.first_name);

    } catch (err) {
      this.logger.warn(`Erreur Claude AI: ${err?.message}`);
      return this.fallback(session.user?.first_name ?? 'utilisateur');
    }
  }

  // ── Contexte financier réel de l'entreprise ──────────────────
  private async buildFinancialContext(companyId: string): Promise<string> {
    try {
      const now     = new Date();
      const month   = now.getMonth() + 1;
      const year    = now.getFullYear();
      const start   = new Date(year, month - 1, 1);
      const end     = new Date(year, month, 0);

      // Écritures du mois en cours
      const entries = await this.prisma.journalEntry.findMany({
        where: {
          company_id: companyId,
          entry_date: { gte: start, lte: end },
        },
        select: {
          total_debit:  true,
          total_credit: true,
          journal_type: true,
          status:       true,
          libelle:      true,
        },
        take: 50,
      });

      const totalDebit  = entries.reduce((s, e) => s + Number(e.total_debit), 0);
      const totalCredit = entries.reduce((s, e) => s + Number(e.total_credit), 0);
      const validated   = entries.filter(e => e.status === 'validee').length;
      const drafts      = entries.filter(e => e.status === 'brouillon').length;

      // Soldes bancaires
      const bankAccounts = await this.prisma.bankAccount.findMany({
        where:  { company_id: companyId, is_active: true },
        select: { name: true, current_balance: true, currency: true },
      });

      const bankSummary = bankAccounts.length > 0
        ? bankAccounts.map(b =>
            `${b.name}: ${Number(b.current_balance).toLocaleString('fr-FR')} ${b.currency}`
          ).join('\n')
        : 'Aucun compte bancaire configuré';

      return `
DONNÉES FINANCIÈRES (${month}/${year}) :
- Écritures du mois : ${entries.length} (${validated} validées, ${drafts} brouillons)
- Total débit du mois : ${totalDebit.toLocaleString('fr-FR')}
- Total crédit du mois : ${totalCredit.toLocaleString('fr-FR')}

TRÉSORERIE :
${bankSummary}
`.trim();

    } catch (err) {
      this.logger.warn(`Erreur chargement contexte: ${err?.message}`);
      return 'Contexte financier non disponible.';
    }
  }

  // ── Prompt système personnalisé ───────────────────────────────
  private buildSystemPrompt(user: any, company: any, context: string | null): string {
    const firstName   = user?.first_name ?? 'Utilisateur';
    const companyName = company?.name ?? 'ton entreprise';
    const system      = company?.accounting_system === 'ohada' ? 'OHADA' : 'PCG France';

    return `Tu es l'assistant comptable IA de Vision R+, qui répond via WhatsApp.

Utilisateur : ${firstName}
Entreprise  : ${companyName} (${system})
${context ? `\n${context}` : ''}

RÈGLES STRICTES :
1. Réponds en 3-5 phrases max — c'est WhatsApp, pas un email
2. Utilise le prénom "${firstName}" naturellement
3. Utilise des emojis sobrement (1-2 max par message)
4. Format : texte simple, pas de markdown complexe (WhatsApp supporte *gras* et _italique_)
5. Si on te demande des données financières → utilise le contexte fourni
6. Si on te demande de créer une écriture → explique comment le faire dans l'app
7. Pour les questions fiscales OHADA ou PCG → réponds avec précision technique
8. Si tu ne sais pas → dis-le clairement et propose d'aller sur visionrplus.com
9. Ne donne JAMAIS de conseils fiscaux engageant ta responsabilité — oriente vers un expert

CAPACITÉS :
- Résumer l'état financier du mois
- Expliquer les règles comptables OHADA et PCG France
- Guider l'utilisation de Vision R+
- Rappeler les échéances fiscales importantes
- Analyser les données du contexte financier fourni`;
  }

  private fallback(firstName: string): string {
    return `Désolé ${firstName}, je rencontre une difficulté technique 😕 Réessaie dans quelques instants ou connecte-toi sur www.visionrplus.com.`;
  }
}
