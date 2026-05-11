import {
  Controller, Get, Param, Query, UseGuards, Res,
} from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { AnalyticsService }   from './analytics.service';
import { JwtAuthGuard }       from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard } from '../common/guards/company-access.guard';

@ApiTags('Analyse financière & KPIs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId/analytics')
export class AnalyticsController {
  constructor(private readonly service: AnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({ summary: 'Dashboard principal — synthèse + KPIs + alertes' })
  getDashboard(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getDashboard(companyId, fiscalYearId);
  }

  @Get('kpis')
  @ApiOperation({ summary: 'Indicateurs clés (CAF, trésorerie, rentabilité, endettement)' })
  getKpis(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getKpis(companyId, fiscalYearId);
  }

  @Get('balance')
  @ApiOperation({ summary: 'Balance générale des comptes' })
  getBalance(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getBalance(companyId, fiscalYearId);
  }

  @Get('bilan')
  @ApiOperation({ summary: 'Bilan comptable OHADA (actif / passif)' })
  getBilan(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getBilan(companyId, fiscalYearId);
  }

  @Get('compte-resultat')
  @ApiOperation({ summary: 'Compte de résultat OHADA (produits / charges)' })
  getCompteResultat(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
  ) {
    return this.service.getCompteResultat(companyId, fiscalYearId);
  }

  @Get('grand-livre')
  @ApiOperation({ summary: 'Grand livre comptable' })
  getGrandLivre(
    @Param('companyId') companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
    @Query('account_code') accountCode?: string,
  ) {
    return this.service.getGrandLivre(companyId, fiscalYearId, accountCode);
  }

  @Get('export-fec')
  @ApiOperation({ summary: 'Export FEC (Fichier des Écritures Comptables — norme DGFiP France)' })
  async exportFec(
    @Param('companyId')      companyId: string,
    @Query('fiscal_year_id') fiscalYearId: string,
    @Res() res: Response,
  ) {
    const fec      = await this.service.exportFec(companyId, fiscalYearId);
    const filename = `FEC_${companyId.slice(0, 8)}_${new Date().toISOString().slice(0, 10)}.txt`;
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(fec);
  }
}
