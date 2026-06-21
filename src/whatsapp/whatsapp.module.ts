import { Module }               from '@nestjs/common';
import { WhatsAppController }   from './whatsapp.controller';
import { WhatsAppService }      from './whatsapp.service';
import { WhatsAppAssistant }    from './whatsapp-assistant.service';
import { PrismaModule }         from '../prisma/prisma.module';

@Module({
  imports:     [PrismaModule],
  controllers: [WhatsAppController],
  providers:   [WhatsAppService, WhatsAppAssistant],
  exports:     [WhatsAppService],
})
export class WhatsAppModule {}
