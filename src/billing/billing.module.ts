import { Module }            from '@nestjs/common';
import { BillingService }    from './billing.service';
import { BillingController } from './billing.controller';
import { CinetPayService }   from './cinetpay.service';
import { BillingSchedulerService } from './billing-scheduler.service';

@Module({
  controllers: [BillingController],
  providers:   [BillingService, CinetPayService, BillingSchedulerService],
  exports:     [BillingService, CinetPayService],
})
export class BillingModule {}
