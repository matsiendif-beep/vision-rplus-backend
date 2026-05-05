import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, UseGuards,
  HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { DocumentsService }   from './documents.service';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';
import { GetUser }            from '../common/decorators';
import { UploadDocumentDto, LinkDocumentDto } from './dto/documents.dto';

@ApiTags('Documents & Pièces justificatives')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId/documents')
export class DocumentsController {
  constructor(private readonly service: DocumentsService) {}

  @Get()
  @ApiOperation({ summary: 'Lister les documents' })
  findAll(
    @Param('companyId') companyId: string,
    @Query('journal_entry_id') journalEntryId?: string,
  ) {
    return this.service.findAll(companyId, { journal_entry_id: journalEntryId });
  }

  @Get('stats')
  @ApiOperation({ summary: 'Statistiques documents' })
  getStats(@Param('companyId') companyId: string) {
    return this.service.getStats(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Détail d\'un document' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.service.findOne(companyId, id);
  }

  // Le frontend upload le fichier directement vers Supabase Storage
  // puis appelle ce endpoint avec les métadonnées + URL
  @Post()
  @ApiOperation({ summary: 'Enregistrer les métadonnées d\'un document uploadé' })
  create(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
    @Body() body: UploadDocumentDto & {
      original_filename: string;
      file_url: string;
      file_key: string;
      mime_type: string;
      file_size_bytes: number;
    },
  ) {
    const { original_filename, file_url, file_key, mime_type, file_size_bytes, ...dto } = body;
    return this.service.create(companyId, userId, dto, {
      originalname: original_filename,
      url:          file_url,
      key:          file_key,
      mimetype:     mime_type,
      size:         file_size_bytes,
    });
  }

  @Patch(':id/link')
  @ApiOperation({ summary: 'Lier un document à une écriture comptable' })
  linkToEntry(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Body() dto: LinkDocumentDto,
  ) {
    return this.service.linkToEntry(companyId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Supprimer un document' })
  @HttpCode(HttpStatus.OK)
  delete(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.service.delete(companyId, id);
  }
}
