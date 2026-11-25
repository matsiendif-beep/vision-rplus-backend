import {
  Controller, Get, Post, Delete,
  Query, Body, Param, Res,
  HttpCode, Logger, UseGuards, Req, ForbiddenException,
} from '@nestjs/common';
import { Response }         from 'express';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { WhatsAppService }  from './whatsapp.service';
import { JwtAuthGuard }     from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';
import { assertMetaSignature, assertTwilioSignature } from '../common/webhook-signature';

@Controller('whatsapp')
export class WhatsAppController {
  private readonly logger = new Logger(WhatsAppController.name);

  constructor(private readonly wa: WhatsAppService) {}

  // ── Vérification webhook Meta (GET) ──────────────────────────
  @Get('webhook')
  verifyWebhook(
    @Query('hub.mode')       mode:      string,
    @Query('hub.verify_token') token:   string,
    @Query('hub.challenge')  challenge: string,
    @Res() res: Response,
  ) {
    const result = this.wa.verifyWebhook(mode, token, challenge);
    if (result !== null) {
      res.status(200).send(result);
    } else {
      res.status(403).send('Forbidden');
    }
  }

  // ── Réception messages entrants (POST) — signés par Meta ─────
  @Post('webhook')
  @SkipThrottle()
  @HttpCode(200)
  async receiveMessage(@Req() req: any, @Body() body: any) {
    assertMetaSignature(req, 'WhatsApp Cloud API');
    this.logger.log('Webhook WhatsApp reçu');
    await this.wa.handleInbound(body);
    return { status: 'ok' };
  }

  // ── Lier WhatsApp à son compte ───────────────────────────────
  //  CompanyAccessGuard vérifie body.company_id : on ne peut lier son
  //  numéro qu'à une entreprise dont on est propriétaire ou membre.
  @Post('link')
  @UseGuards(JwtAuthGuard, CompanyAccessGuard)
  async linkPhone(
    @Req() req: any,
    @Body() body: { phone_number: string; company_id?: string },
  ) {
    await this.wa.linkPhoneNumber(req.user.id, body.phone_number, body.company_id);
    await this.wa.notifyWelcome(req.user.id, req.user.first_name ?? '');
    return { message: 'Numéro WhatsApp lié avec succès' };
  }

  // ── Délier WhatsApp ───────────────────────────────────────────
  @Delete('link')
  @UseGuards(JwtAuthGuard)
  async unlinkPhone(@Req() req: any) {
    await this.wa.unlinkPhoneNumber(req.user.id);
    return { message: 'Numéro WhatsApp délié' };
  }

  // ── Test — envoyer un message ─────────────────────────────────
  //  Chacun peut se tester lui-même ; viser un autre utilisateur est
  //  réservé aux emails listés dans ADMIN_EMAILS (séparés par des virgules).
  @Post('test/:userId')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @UseGuards(JwtAuthGuard)
  async testNotification(
    @Req() req: any,
    @Param('userId') userId: string,
    @Body() body: { message: string },
  ) {
    const admins = (process.env.ADMIN_EMAILS ?? '').split(',').map((e) => e.trim().toLowerCase()).filter(Boolean);
    const isAdmin = admins.includes(String(req.user.email).toLowerCase());
    if (userId !== req.user.id && !isAdmin) {
      throw new ForbiddenException('Vous ne pouvez envoyer un test qu\'à votre propre numéro');
    }
    await this.wa.notifyFinancialAlert(userId, 'custom', body.message);
    return { message: 'Notification envoyée' };
  }

  // ══════════════════════════════════════════════════════════════
  //  TWILIO — Alternative sans vérification Meta
  //  Configurer dans Twilio Console > Messaging > WhatsApp Sandbox:
  //    Webhook URL: {BACKEND_URL}/whatsapp/twilio/webhook
  //    Méthode: HTTP POST
  // ══════════════════════════════════════════════════════════════

  @Post('twilio/webhook')
  @SkipThrottle()
  @HttpCode(200)
  async twilioWebhook(@Req() req: any, @Body() body: any) {
    assertTwilioSignature(req, 'Twilio WhatsApp');
    this.logger.log(`[Twilio] Webhook reçu de ${body.From ?? 'inconnu'}`);
    await this.wa.handleTwilioInbound(body);
    // Twilio attend une réponse TwiML ou vide (200 suffit)
    return '';
  }
}
