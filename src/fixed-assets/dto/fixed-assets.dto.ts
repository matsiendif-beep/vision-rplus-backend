import {
  IsString, IsOptional, IsEnum, IsNumber,
  IsDateString, IsBoolean, Min, IsUUID,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DepreciationMethod { LINEAIRE = 'lineaire', DEGRESSIVE = 'degressive' }

export class CreateFixedAssetDto {
  @ApiProperty() @IsString() name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() reference?: string;

  @ApiPropertyOptional() @IsOptional() @IsUUID() asset_account_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() depreciation_account_id?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() accumulated_account_id?: string;

  @ApiProperty() @IsDateString() acquisition_date: string;
  @ApiPropertyOptional() @IsOptional() @IsDateString() commissioning_date?: string;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(0) gross_value: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) residual_value?: number;

  @ApiProperty() @Type(() => Number) @IsNumber() @Min(1) useful_life_years: number;
  @ApiPropertyOptional({ enum: DepreciationMethod })
  @IsOptional() @IsEnum(DepreciationMethod) depreciation_method?: DepreciationMethod;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() degressive_rate?: number;

  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() serial_number?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplier?: string;
}

export class UpdateFixedAssetDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() location?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() is_active?: boolean;
}

export class DisposeAssetDto {
  @ApiProperty() @IsDateString() disposal_date: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) disposal_value?: number;
}
