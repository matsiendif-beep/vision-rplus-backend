import { Module }            from '@nestjs/common';
import { AccountsService }   from './accounts.service';
import { AccountsController } from './accounts.controller';
import { ReclassificationService } from './reclassification.service';

@Module({
  controllers: [AccountsController],
  providers:   [AccountsService, ReclassificationService],
  exports:     [AccountsService],
})
export class AccountsModule {}
