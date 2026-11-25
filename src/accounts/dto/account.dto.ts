import {
  IsString, IsEnum, IsOptional,
  IsBoolean, MaxLength, MinLength, Matches,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { AccountingSystem, AccountType } from '@prisma/client';

/** Création d'un sous-compte. Le type, la classe et le plan sont déduits
 *  automatiquement du compte parent : ils ne peuvent pas être choisis. */
export class CreateAccountDto {
  @IsString()
  @Matches(/^\d{3,10}$/, { message: 'Le numéro de compte doit comporter de 3 à 10 chiffres' })
  code: string;

  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Indiquez un libellé (2 caractères minimum)' })
  @MaxLength(255)
  label: string;
}

/** Seul le libellé d'un sous-compte peut être modifié (le numéro fixe sa place
 *  dans le bilan ou le compte de résultat). */
export class UpdateAccountDto {
  @IsString()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @MinLength(2, { message: 'Indiquez un libellé (2 caractères minimum)' })
  @MaxLength(255)
  label: string;
}

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
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  is_detail?: boolean;
}
