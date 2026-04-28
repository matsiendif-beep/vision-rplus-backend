import { Module }          from '@nestjs/common';
import { JournalService }  from './journal.service';
import { JournalController } from './journal.controller';
import { AccountingEngine }  from './accounting.engine';

@Module({
  controllers: [JournalController],
  providers:   [JournalService, AccountingEngine],
  exports:     [JournalService, AccountingEngine],
})
export class JournalModule {}
