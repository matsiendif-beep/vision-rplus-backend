import {
  IsEnum, IsUUID, IsDateString, IsOptional, IsString,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TaxType {
  TVA_COLLECTEE  = 'tva_collectee',
  TVA_DEDUCTIBLE = 'tva_deductible',
  IS             = 'is',
  DSF            = 'dsf',
  PATENTE        = 'patente',
  TFPB           = 'tfpb',
  AUTRE          = 'autre',
}

export class CreateTaxDeclarationDto {
  @ApiProperty({ enum: TaxType }) @IsEnum(TaxType)   tax_type: TaxType;
  @ApiProperty() @IsUUID()                            fiscal_year_id: string;
  @ApiProperty() @IsDateString()                      period_start: string;
  @ApiProperty() @IsDateString()                      period_end: string;
}

export class ValidateTaxDeclarationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}

export class GenerateDsfDto {
  @ApiProperty() @IsUUID() fiscal_year_id: string;
}
