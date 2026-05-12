/**
 * Vision R+ — Webhook ManyChat & Meta Messenger
 *
 * Ce contrôleur reçoit les messages entrants depuis :
 * - ManyChat (Flow Builder → External Request)
 * - Messenger / Instagram DMs via Meta Webhooks
 *
 * Il génère une réponse personnalisée avec Claude et la renvoie.
 *
 * Configuration ManyChat :
 * 1. Dans ton flow ManyChat, ajoute un bloc "External Request"
 * 2. URL : https://ton-backend.com/social/manychat-webhook
 * 3. Méthode : POST
 * 4. Body : { "message": "{{last user input}}", "firstName": "{{first name}}" }
 * 5. Récupère la réponse : {{external_request.response.reply}}
 *
 * Configuration Meta Webhook (optionnel — sans ManyChat) :
 * 1. Dans Meta for Developers → ton App → Webhooks
 * 2. Callback URL : https://ton-backend.com/social/meta-webhook
 * 3. Verify Token : valeur de WEBHOOK_VERIFY_TOKEN dans .env
 * 4. Events : messages, comments
 */

import {
  Controller, Post, Get, Body, Query, Logger,
  HttpCode, HttpStatus, BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SocialService } from './social.service';

@ApiTags('Social Media — Webhooks')
@Controller('social')
export class SocialController {
  private readonly logger = new Logger(SocialController.name);

  constructor(private readonly service: SocialService) {}

  // ── ManyChat Webhook ──────────────────────────────────────────
  // Appelé par ManyChat quand un abonné envoie un message ou touche un bouton
  @Post('manychat-webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Webhook ManyChat — réponse IA aux messages entrants' })
  async manyChatWebhook(@Body() body: { message?: string; firstName?: string; intent?: string }) {
    const { message = '', firstName = 'ami(e)', intent } = body;
    this.logger.log(`ManyChat webhook — "${firstName}": "${message}" | intent: ${intent ?? 'none'}`);

    if (!message && !intent) throw new BadRequestException('message ou intent requis');

    const reply = await this.service.generateReply(message, firstName, intent);
    return { reply };
  }

  // ── Meta Webhook — Vérification (GET) ────────────────────────
  // Meta envoie un GET pour vérifier que l'URL est valide
  @Get('meta-webhook')
  @ApiOperation({ summary: 'Meta Webhook — vérification du token (challenge)' })
  verifyMetaWebhook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ) {
    const expectedToken = process.env.WEBHOOK_VERIFY_TOKEN ?? 'vision_rplus_webhook_2026';
    if (mode === 'subscribe' && token === expectedToken) {
      this.logger.log('Meta Webhook vérifié avec succès');
      return parseInt(challenge, 10);
    }
    throw new BadRequestException('Token de vérification invalide');
  }

  // ── Meta Webhook — Messages entrants (POST) ──────────────────
  // Reçoit les DMs Instagram ou Messenger et répond automatiquement
  @Post('meta-webhook')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Meta Webhook — réception et traitement des DMs entrants' })
  async handleMetaWebhook(@Body() body: any) {
    // Meta attend toujours un 200 immédiat, même si le traitement prend du temps
    // On log et on traite en async (fire-and-forget pour respecter le délai Meta)
    this.service.processMetaEvent(body).catch((err) =>
      this.logger.error('Erreur traitement Meta event', err),
    );
    return { status: 'received' };
  }
}
