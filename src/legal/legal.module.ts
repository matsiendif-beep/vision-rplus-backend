import { Module } from '@nestjs/common';
import { LegalController, HealthController } from './legal.controller';

@Module({
  controllers: [LegalController, HealthController],
})
export class LegalModule {}
