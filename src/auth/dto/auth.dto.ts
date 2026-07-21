// ════════════════════════════════════════════════════════════
//  AUTH MODULE — Vision R+
//  Fichiers : dto, strategy, service, controller, module
// ════════════════════════════════════════════════════════════

// ── auth/dto/auth.dto.ts ──────────────────────────────────────

import {
  IsEmail, IsString, MinLength,
  IsOptional, MaxLength,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RegisterDto {
  @ApiProperty({ example: 'arnaud@visionrplus.com' })
  @IsEmail({}, { message: 'Email invalide' })
  email: string;

  @ApiProperty({ example: 'motdepasse123', minLength: 8 })
  @IsString()
  @MinLength(8, { message: 'Mot de passe : 8 caractères minimum' })
  password: string;

  @ApiProperty({ example: 'Arnaud' })
  @IsString()
  @MaxLength(100)
  first_name: string;

  @ApiProperty({ example: 'Moussounda' })
  @IsString()
  @MaxLength(100)
  last_name: string;

  @ApiProperty({ example: '+33600000000', required: false })
  @IsOptional()
  @IsString()
  phone?: string;
}

export class LoginDto {
  @ApiProperty({ example: 'arnaud@visionrplus.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'motdepasse123' })
  @IsString()
  password: string;
}

export class InviteClientDto {
  @ApiProperty({ example: 'uuid-company-id' })
  @IsString()
  company_id: string;

  @ApiProperty({ example: 'lecture', enum: ['admin', 'comptable', 'lecture'] })
  @IsOptional()
  @IsString()
  role?: string;
}

export class AcceptInviteDto {
  @ApiProperty()
  @IsString()
  token: string;

  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  first_name: string;

  @ApiProperty()
  @IsString()
  @MaxLength(100)
  last_name: string;
}
