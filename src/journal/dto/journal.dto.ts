import {
  IsString, IsEnum, IsOptional,
  IsDateString, IsArray, ValidateNested,
  IsNumber, Min, MaxLength, IsUUID,
} from 'class-validator';
import { Type, Transform } from 'class-transformer';
import { PartialType }     from '@nestjs/mapped-types';
import { ApiProperty }     from '@nestjs/swagger';
import { JournalType }     from '@prisma/client';

// ── Ligne d'écriture ─────────────────────────────────────────
export class JournalLineDto {
  @ApiProperty({ example: 'uuid-compte', description: 'ID du compte (accounts.id)', required: false })
  @IsOptional()
  @Transform(({ value }) => value || undefined)
  @IsUUID()
  account_id?: string;

  @ApiProperty({ example: 'Achat matériel', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  libelle?: string;

  @ApiProperty({ example: 1200, description: 'Montant débit (0 si ligne crédit)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  debit: number;

  @ApiProperty({ example: 0, description: 'Montant crédit (0 si ligne débit)' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  credit: number;
}

// ── Créer une écriture ────────────────────────────────────────
export class CreateJournalEntryDto {
  @ApiProperty({ example: 'uuid-exercice' })
  @IsUUID()
  fiscal_year_id: string;

  @ApiProperty({ enum: JournalType, example: 'banque' })
  @IsEnum(JournalType, {
    message: 'Journal invalide. Valeurs : achats, ventes, banque, caisse, od, salaires, actif',
  })
  journal_type: JournalType;

  @ApiProperty({ example: '2025-05-15' })
  @IsDateString()
  entry_date: string;

  @ApiProperty({ example: 'Achat matériel informatique' })
  @IsString()
  @MaxLength(500)
  libelle: string;

  @ApiProperty({ example: 'FAC-2025-001', required: false })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  reference?: string;

  @ApiProperty({ type: [JournalLineDto], minItems: 2 })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JournalLineDto)
  lines: JournalLineDto[];
}

// ── Modifier une écriture (brouillon uniquement) ──────────────
export class UpdateJournalEntryDto extends PartialType(CreateJournalEntryDto) {}

// ── Filtres pour la liste des écritures ──────────────────────
export class FilterEntriesDto {
  @IsOptional()
  @IsEnum(JournalType)
  journal_type?: JournalType;

  @IsOptional()
  @IsString()
  status?: 'brouillon' | 'validee' | 'annulee';

  @IsOptional()
  @IsDateString()
  date_from?: string;

  @IsOptional()
  @IsDateString()
  date_to?: string;

  @IsOptional()
  @IsString()
  search?: string;      // Libellé ou référence

  @IsOptional()
  @IsUUID()
  fiscal_year_id?: string;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  page?: number = 1;

  @IsOptional()
  @Transform(({ value }) => parseInt(value))
  @IsNumber()
  @Min(1)
  limit?: number = 30;
}

// ── Contrepassation d'une écriture ────────────────────────────
export class ReverseEntryDto {
  @ApiProperty({ example: '2025-06-01', description: 'Date de l\'écriture de contrepassation' })
  @IsDateString()
  reversal_date: string;

  @ApiProperty({ example: 'Contrepassation FAC-2025-001', required: false })
  @IsOptional()
  @IsString()
  libelle?: string;
}
