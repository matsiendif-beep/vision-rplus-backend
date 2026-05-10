import {
  Controller, Get, Post, Patch, Delete,
  Body, Param, Query, Res, UseGuards,
  HttpCode, HttpStatus,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { DocumentsService }   from './documents.service';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';
import { GetUser }            from '../common/decorators';
import { LinkDocumentDto } from './dto/documents.dto';

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

  // Upload multipart direct — le fichier est stocké côté backend
  @Post()
  @ApiOperation({ summary: 'Uploader un document (PDF, JPG, PNG — max 10 Mo)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  async create(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
    @Body('document_type') documentType?: string,
    @Body('note') note?: string,
    @Body('journal_entry_id') journalEntryId?: string,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    return this.service.createFromUpload(companyId, userId, file, {
      document_type:    documentType,
      note,
      journal_entry_id: journalEntryId,
    });
  }

  // Télécharger / visualiser le fichier
  @Get(':id/file')
  @ApiOperation({ summary: 'Télécharger le fichier d\'un document' })
  async serveFile(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const { buffer, mimeType, filename } = await this.service.getFileBuffer(companyId, id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.send(buffer);
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
