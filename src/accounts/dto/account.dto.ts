import {
  IsString, IsEnum, IsOptional,
  IsBoolean, MaxLength, Matches,
} from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { ApiProperty } from '@nestjs/swagger';
import { AccountingSystem, AccountType } from '@prisma/client';

export class CreateAccountDto {
  @ApiProperty({ example: '706', description: 'Code du compte (ex: 706, 401, 521)' })
  @IsString()
  @MaxLength(10)
  @Matches(/^\d+$/, { message: 'Le code doit être numérique' })
  code: string;

  @ApiProperty({ example: 'Services vendus' })
  @IsString()
  @MaxLength(255)
  label: string;

  @ApiProperty({ enum: AccountType, example: 'produit' })
  @IsEnum(AccountType, {
    message: 'Type invalide. Valeurs : actif, passif, charge, produit, tresorerie, analytique',
  })
  type: AccountType;

  @ApiProperty({ enum: AccountingSystem, example: 'pcg_france' })
  @IsEnum(AccountingSystem)
  system: AccountingSystem;

  @ApiProperty({ example: '70', required: false, description: 'Code du compte parent' })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  parent_code?: string;

  @ApiProperty({ example: true, default: true })
  @IsOptional()
  @IsBoolean()
  is_detail?: boolean;
}

export class UpdateAccountDto extends PartialType(CreateAccountDto) {}

export class FilterAccountsDto {
  @IsOptional()
  @IsEnum(AccountType)
  type?: AccountType;

  @IsOptional()
  @IsEnum(AccountingSystem)
  system?: AccountingSystem;

  @IsOptional()
  @IsString()
  search?: string;       // Recherche sur code ou label

  @IsOptional()
  @IsBoolean()
  is_detail?: boolean;
}
