import {
  Controller, Get, Post, Delete,
  Query, Body, Param, Res,
  HttpCode, Logger, UseGuards, Req,
} from '@nestjs/common';
import { Response }         from 'express';
import { WhatsAppService }  from './whatsapp.service';
import { JwtAuthGuard }     from '../common/guards/jwt-auth.guard';

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

  // ── Réception messages entrants (POST) ───────────────────────
  @Post('webhook')
  @HttpCode(200)
  async receiveMessage(@Body() body: any) {
    this.logger.log('Webhook WhatsApp reçu');
    await this.wa.handleInbound(body);
    return { status: 'ok' };
  }

  // ── Lier WhatsApp à son compte ───────────────────────────────
  @Post('link')
  @UseGuards(JwtAuthGuard)
  async linkPhone(
    @Req() req: any,
    @Body() body: { phone_number: string; company_id?: string },
  ) {
    await this.wa.linkPhoneNumber(req.user.userId, body.phone_number, body.company_id);
    await this.wa.notifyWelcome(req.user.userId, req.user.firstName ?? '');
    return { message: 'Numéro WhatsApp lié avec succès' };
  }

  // ── Délier WhatsApp ───────────────────────────────────────────
  @Delete('link')
  @UseGuards(JwtAuthGuard)
  async unlinkPhone(@Req() req: any) {
    await this.wa.unlinkPhoneNumber(req.user.userId);
    return { message: 'Numéro WhatsApp délié' };
  }

  // ── Test — envoyer un message (admin uniquement) ──────────────
  @Post('test/:userId')
  @UseGuards(JwtAuthGuard)
  async testNotification(
    @Param('userId') userId: string,
    @Body() body: { message: string },
  ) {
    await this.wa.notifyFinancialAlert(userId, 'custom', body.message);
    return { message: 'Notification envoyée' };
  }
}
