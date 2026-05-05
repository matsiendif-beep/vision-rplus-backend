import {
  IsString, IsOptional, IsEnum, IsUUID,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum DocumentType {
  FACTURE          = 'facture',
  RECU             = 'recu',
  RELEVE_BANCAIRE  = 'releve_bancaire',
  CONTRAT          = 'contrat',
  BON_COMMANDE     = 'bon_commande',
  BULLETIN_SALAIRE = 'bulletin_salaire',
  AUTRE            = 'autre',
}

export class UploadDocumentDto {
  @ApiPropertyOptional({ enum: DocumentType })
  @IsOptional() @IsEnum(DocumentType)
  document_type?: DocumentType;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  journal_entry_id?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString()
  note?: string;
}

export class LinkDocumentDto {
  @ApiPropertyOptional() @IsOptional() @IsUUID() journal_entry_id?: string;
}
