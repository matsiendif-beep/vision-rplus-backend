import { Module }            from '@nestjs/common';
import { BillingService }    from './billing.service';
import { BillingController } from './billing.controller';
import { CinetPayService }   from './cinetpay.service';

@Module({
  controllers: [BillingController],
  providers:   [BillingService, CinetPayService],
  exports:     [BillingService, CinetPayService],
})
export class BillingModule {}
