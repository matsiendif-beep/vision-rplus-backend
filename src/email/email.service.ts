// ── email/email.service.ts ───────────────────────────────────
//  Envoi d'emails transactionnels via l'API Brevo (ex-Sendinblue).
//  Sans BREVO_API_KEY, les envois sont ignorés (log) : l'appli
//  démarre et fonctionne normalement.
// ─────────────────────────────────────────────────────────────
import { Injectable, Logger } from '@nestjs/common';

export interface SendEmailInput {
  to:      { email: string; name?: string };
  subject: string;
  html:    string;
  text?:   string;
  tags?:   string[];
}

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  get enabled(): boolean {
    return !!process.env.BREVO_API_KEY;
  }

  async send(input: SendEmailInput): Promise<boolean> {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      this.logger.warn(`BREVO_API_KEY non défini — email "${input.subject}" non envoyé`);
      return false;
    }

    const fromEmail = process.env.EMAIL_FROM      ?? 'contact@visionrplus.com';
    const fromName  = process.env.EMAIL_FROM_NAME ?? 'Vision R+';
    const replyTo   = process.env.EMAIL_REPLY_TO  ?? fromEmail;

    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method:  'POST',
        headers: {
          'api-key':      apiKey,
          'content-type': 'application/json',
          accept:         'application/json',
        },
        body: JSON.stringify({
          sender:      { email: fromEmail, name: fromName },
          replyTo:     { email: replyTo,   name: fromName },
          to:          [input.to],
          subject:     input.subject,
          htmlContent: input.html,
          textContent: input.text,
          tags:        input.tags,
        }),
        signal: AbortSignal.timeout(15_000),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => '');
        this.logger.error(`Brevo ${res.status} pour ${input.to.email} : ${body.slice(0, 300)}`);
        return false;
      }
      return true;
    } catch (e: any) {
      this.logger.error(`Échec envoi email à ${input.to.email} : ${e.message}`);
      return false;
    }
  }
}
