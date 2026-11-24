import { Global, Module }          from '@nestjs/common';
import { EmailService }            from './email.service';
import { OnboardingEmailsService } from './onboarding-emails.service';
import { EmailController }         from './email.controller';

@Global()
@Module({
  controllers: [EmailController],
  providers:   [EmailService, OnboardingEmailsService],
  exports:     [EmailService, OnboardingEmailsService],
})
export class EmailModule {}
