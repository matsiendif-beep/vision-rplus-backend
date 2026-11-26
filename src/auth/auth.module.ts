import { Module }          from '@nestjs/common';
import { JwtModule }       from '@nestjs/jwt';
import { PassportModule }  from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService }     from './auth.service';
import { AuthController }  from './auth.controller';
import { JwtStrategy }     from './jwt.strategy';
import { AccountClosureService } from './account-closure.service';
import { BillingModule }   from '../billing/billing.module';

@Module({
  imports: [
    BillingModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      inject:     [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret:      config.get('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '7d') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers:   [AuthService, JwtStrategy, AccountClosureService],
  exports:     [JwtStrategy, PassportModule],
})
export class AuthModule {}
