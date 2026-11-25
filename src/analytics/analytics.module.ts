import { Module }               from '@nestjs/common';
import { AnalyticsController }  from './analytics.controller';
import { AnalyticsService }     from './analytics.service';
import { NotificationsService } from './notifications.service';
import { AccountsModule }       from '../accounts/accounts.module';

@Module({
  imports:     [AccountsModule],
  controllers: [AnalyticsController],
  providers:   [AnalyticsService, NotificationsService],
  exports:     [AnalyticsService],
})
export class AnalyticsModule {}
