// ── common/webhook-signature.ts ──────────────────────────────
//  Vérification de l'authenticité des webhooks entrants.
//  Sans ces contrôles, n'importe qui pourrait envoyer de faux
//  messages « au nom » de Meta, Twilio ou ManyChat.
// ─────────────────────────────────────────────────────────────
import { createHmac, timingSafeEqual } from 'crypto';
import { ForbiddenException, Logger } from '@nestjs/common';
import type { Request } from 'express';

const logger = new Logger('WebhookSignature');

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Meta (WhatsApp Cloud API, Messenger, Instagram) : en-tête X-Hub-Signature-256
 *  = "sha256=" + HMAC-SHA256(corps brut, META_APP_SECRET). */
export function assertMetaSignature(req: Request & { rawBody?: Buffer }, source: string) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    logger.error(`${source} : META_APP_SECRET non défini — webhook refusé`);
    throw new ForbiddenException('Webhook non configuré');
  }
  const header = req.headers['x-hub-signature-256'];
  if (typeof header !== 'string' || !req.rawBody) {
    throw new ForbiddenException('Signature manquante');
  }
  const expected = 'sha256=' + createHmac('sha256', secret).update(req.rawBody).digest('hex');
  if (!safeEqual(header, expected)) {
    logger.warn(`${source} : signature Meta invalide (IP ${req.ip})`);
    throw new ForbiddenException('Signature invalide');
  }
}

/** Twilio : en-tête X-Twilio-Signature = base64(HMAC-SHA1(URL + paramètres POST
 *  triés par nom et concaténés, TWILIO_AUTH_TOKEN)).
 *  https://www.twilio.com/docs/usage/security#validating-requests */
export function assertTwilioSignature(req: Request, source: string) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) {
    logger.error(`${source} : TWILIO_AUTH_TOKEN non défini — webhook refusé`);
    throw new ForbiddenException('Webhook non configuré');
  }
  const header = req.headers['x-twilio-signature'];
  if (typeof header !== 'string') throw new ForbiddenException('Signature manquante');

  // URL exacte appelée par Twilio. Derrière le proxy Railway, on la reconstruit ;
  // TWILIO_WEBHOOK_URL permet de la fixer si besoin.
  const url = process.env.TWILIO_WEBHOOK_URL || `${req.protocol}://${req.get('host')}${req.originalUrl}`;
  const params = (req.body ?? {}) as Record<string, unknown>;
  const data = Object.keys(params).sort()
    .reduce((acc, k) => acc + k + (Array.isArray(params[k]) ? (params[k] as unknown[]).join('') : String(params[k] ?? '')), url);
  const expected = createHmac('sha1', token).update(Buffer.from(data, 'utf-8')).digest('base64');
  if (!safeEqual(header, expected)) {
    logger.warn(`${source} : signature Twilio invalide (URL utilisée : ${url})`);
    throw new ForbiddenException('Signature invalide');
  }
}

/** Secret partagé simple (ManyChat ne signe pas ses requêtes) :
 *  en-tête X-Webhook-Secret = MANYCHAT_WEBHOOK_SECRET. */
export function assertSharedSecret(req: Request, envName: string, source: string) {
  const secret = process.env[envName];
  if (!secret) {
    logger.error(`${source} : ${envName} non défini — webhook refusé`);
    throw new ForbiddenException('Webhook non configuré');
  }
  const header = req.headers['x-webhook-secret'];
  if (typeof header !== 'string' || !safeEqual(header, secret)) {
    logger.warn(`${source} : secret invalide (IP ${req.ip})`);
    throw new ForbiddenException('Secret invalide');
  }
}
