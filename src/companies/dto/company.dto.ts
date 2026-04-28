import {
  IsString, IsEnum, IsOptional, IsEmail,
  IsUrl, IsDateString, MaxLength, IsBoolean,
} from 'class-validator';
import { PartialType }   from '@nestjs/mapped-types';
import { ApiProperty }   from '@nestjs/swagger';
import { AccountingSystem, Currency } from '@prisma/client';

export class CreateCompanyDto {
  @ApiProperty({ example: 'Vision R+ Consulting' })
  @IsString()
  @MaxLength(255)
  name: string;

  @ApiProperty({ example: 'SAS', required: false })
  @IsOptional()
  @IsString()
  legal_form?: string;

  @ApiProperty({ enum: AccountingSystem, example: 'pcg_france' })
  @IsEnum(AccountingSystem, {
    message: 'Système comptable invalide. Valeurs : ohada, pcg_france',
  })
  accounting_system: AccountingSystem;

  @ApiProperty({ enum: Currency, example: 'EUR', default: 'EUR' })
  @IsOptional()
  @IsEnum(Currency)
  currency?: Currency;

  @ApiProperty({ example: 'France' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiProperty({ example: '64000' })
  @IsOptional()
  @IsString()
  postal_code?: string;

  @ApiProperty({ example: 'Pau' })
  @IsOptional()
  @IsString()
  city?: string;

  @ApiProperty({ example: '15 rue des Entrepreneurs' })
  @IsOptional()
  @IsString()
  address?: string;

  @ApiProperty({ example: '+33500000000' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({ example: 'contact@visionrplus.com' })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiProperty({ example: 'https://visionrplus.com' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiProperty({ example: '12345678901234' })
  @IsOptional()
  @IsString()
  @MaxLength(14)
  siret?: string;

  // Champs OHADA
  @ApiProperty({ example: 'RC/LBV/2025/B/1234', required: false })
  @IsOptional()
  @IsString()
  rccm?: string;

  @ApiProperty({ example: 'NIF-2025-001', required: false })
  @IsOptional()
  @IsString()
  nif?: string;

  @ApiProperty({ example: '2025-01-01' })
  @IsDateString()
  fiscal_year_start: string;

  @ApiProperty({ example: '2025-12-31' })
  @IsDateString()
  fiscal_year_end: string;
}

export class UpdateCompanyDto extends PartialType(CreateCompanyDto) {
  @IsOptional()
  @IsBoolean()
  is_active?: boolean;
}
