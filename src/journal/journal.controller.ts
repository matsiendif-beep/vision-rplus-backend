import {
  Controller, Get, Post, Patch, Delete, HttpCode, HttpStatus,
  Body, Param, Query, UseGuards, Res,
  UploadedFile, UseInterceptors, BadRequestException,
} from '@nestjs/common';
import { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { JournalService }    from './journal.service';
import {
  CreateJournalEntryDto,
  UpdateJournalEntryDto,
  FilterEntriesDto,
  ReverseEntryDto,
} from './dto/journal.dto';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';
import { GetUser }            from '../common/decorators';

@ApiTags('Journal & États financiers')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId')
export class JournalController {
  constructor(private readonly service: JournalService) {}

  // ══════════════════════════════════════════════════════════
  //  JOURNAL — ÉCRITURES
  // ══════════════════════════════════════════════════════════

  // POST /companies/:companyId/entries
  @Post('entries')
  @ApiOperation({ summary: 'Saisir une nouvelle écriture comptable' })
  createEntry(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
    @Body() dto: CreateJournalEntryDto,
  ) {
    return this.service.createEntry(companyId, userId, dto);
  }

  // GET /companies/:companyId/entries/export-csv
  @Get('entries/export-csv')
  @ApiOperation({ summary: 'Exporter le journal en CSV (toutes les écritures avec leurs lignes)' })
  async exportCsv(
    @Param('companyId')       companyId: string,
    @Query('fiscal_year_id')  fiscalYearId: string | undefined,
    @Res() res: Response,
  ) {
    const csv      = await this.service.exportCsv(companyId, fiscalYearId);
    const filename = `journal_${companyId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('﻿' + csv); // BOM UTF-8 pour Excel
  }

  // GET /companies/:companyId/entries
  @Get('entries')
  @ApiOperation({ summary: 'Journal comptable (liste paginée et filtrée)' })
  findAll(
    @Param('companyId') companyId: string,
    @Query() filters: FilterEntriesDto,
  ) {
    return this.service.findAllEntries(companyId, filters);
  }

  // GET /companies/:companyId/entries/:entryId
  @Get('entries/:entryId')
  @ApiOperation({ summary: 'Détail d\'une écriture avec ses lignes' })
  findOne(
    @Param('companyId') companyId: string,
    @Param('entryId')   entryId: string,
  ) {
    return this.service.findOneEntry(entryId, companyId);
  }

  // PATCH /companies/:companyId/entries/:entryId
  @Patch('entries/:entryId')
  @ApiOperation({ summary: 'Modifier une écriture en brouillon' })
  update(
    @Param('companyId') companyId: string,
    @Param('entryId')   entryId: string,
    @GetUser('id') userId: string,
    @Body() dto: UpdateJournalEntryDto,
  ) {
    return this.service.updateEntry(entryId, companyId, userId, dto);
  }

  // DELETE /companies/:companyId/entries/:entryId
  @Delete('entries/:entryId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer une écriture en brouillon' })
  deleteEntry(
    @Param('companyId') companyId: string,
    @Param('entryId')   entryId: string,
  ) {
    return this.service.deleteEntry(entryId, companyId);
  }

  // POST /companies/:companyId/entries/:entryId/validate
  @Post('entries/:entryId/validate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Valider une écriture (brouillon → définitive)' })
  validate(
    @Param('companyId') companyId: string,
    @Param('entryId')   entryId: string,
    @GetUser('id') userId: string,
  ) {
    return this.service.validateEntry(entryId, companyId, userId);
  }

  // POST /companies/:companyId/entries/import-csv
  @Post('entries/import-csv')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Importer des écritures depuis un fichier CSV (format Vision R+)' })
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  importCsv(
    @Param('companyId') companyId: string,
    @GetUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('Aucun fichier fourni');
    return this.service.importCsv(companyId, userId, file.buffer);
  }

  // DELETE /companies/:companyId/entries/unbalanced-drafts
  @Delete('entries/unbalanced-drafts')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Supprimer tous les brouillons déséquilibrés (< 2 lignes ou débit ≠ crédit)' })
  deleteUnbalancedDrafts(@Param('companyId') companyId: string) {
    return this.service.deleteUnbalancedDrafts(companyId);
  }

  // POST /companies/:companyId/entries/:entryId/reverse
  @Post('entries/:entryId/reverse')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Contrepasser une écriture validée' })
  reverse(
    @Param('companyId') companyId: string,
    @Param('entryId')   entryId: string,
    @GetUser('id') userId: string,
    @Body() dto: ReverseEntryDto,
  ) {
    return this.service.reverseEntry(entryId, companyId, userId, dto);
  }

  // ══════════════════════════════════════════════════════════
  //  ÉTATS FINANCIERS
  // ══════════════════════════════════════════════════════════

  // GET /companies/:companyId/fiscal-years/:fiscalYearId/income-statement
  @Get('fiscal-years/:fiscalYearId/income-statement')
  @ApiOperation({ summary: 'Compte de résultat automatique (Produits - Charges)' })
  getIncomeStatement(
    @Param('companyId')    companyId: string,
    @Param('fiscalYearId') fiscalYearId: string,
  ) {
    return this.service.getIncomeStatement(companyId, fiscalYearId);
  }

  // GET /companies/:companyId/fiscal-years/:fiscalYearId/balance-sheet
  @Get('fiscal-years/:fiscalYearId/balance-sheet')
  @ApiOperation({ summary: 'Bilan comptable automatique (Actif / Passif)' })
  getBalanceSheet(
    @Param('companyId')    companyId: string,
    @Param('fiscalYearId') fiscalYearId: string,
  ) {
    return this.service.getBalanceSheet(companyId, fiscalYearId);
  }

  // GET /companies/:companyId/fiscal-years/:fiscalYearId/dashboard
  @Get('fiscal-years/:fiscalYearId/dashboard')
  @ApiOperation({ summary: 'Dashboard financier : trésorerie, résultat, évolution mensuelle' })
  getDashboard(
    @Param('companyId')    companyId: string,
    @Param('fiscalYearId') fiscalYearId: string,
  ) {
    return this.service.getDashboard(companyId, fiscalYearId);
  }
}
