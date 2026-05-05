import {
  Controller, Get, Post, Patch, Body, Param,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { TaxService }            from './tax.service';
import { JwtAuthGuard }          from '../common/guards/jwt-auth.guard';
import { CompanyAccessGuard }    from '../common/guards/company-access.guard';
import { GetUser }               from '../common/decorators';
import {
  CreateTaxDeclarationDto, ValidateTaxDeclarationDto, GenerateDsfDto,
} from './dto/tax.dto';

@ApiTags('Fiscalité & DSF')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, CompanyAccessGuard)
@Controller('companies/:companyId')
export class TaxController {
  constructor(private readonly service: TaxService) {}

  @Get('tax-declarations')
  @ApiOperation({ summary: 'Lister les déclarations fiscales' })
  findAll(@Param('companyId') companyId: string) {
    return this.service.findAll(companyId);
  }

  @Post('tax-declarations')
  @ApiOperation({ summary: 'Créer/calculer une déclaration fiscale (TVA, IS…)' })
  create(
    @Param('companyId') companyId: string,
    @Body() dto: CreateTaxDeclarationDto,
  ) {
    return this.service.create(companyId, dto);
  }

  @Patch('tax-declarations/:id/validate')
  @ApiOperation({ summary: 'Valider une déclaration' })
  validate(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
    @GetUser('id') userId: string,
    @Body() dto: ValidateTaxDeclarationDto,
  ) {
    return this.service.validate(companyId, id, userId, dto);
  }

  @Patch('tax-declarations/:id/submit')
  @ApiOperation({ summary: 'Marquer une déclaration comme déposée' })
  markSubmitted(
    @Param('companyId') companyId: string,
    @Param('id') id: string,
  ) {
    return this.service.markSubmitted(companyId, id);
  }

  // ── DSF — Génération complète ─────────────────────────────
  @Post('dsf/generate')
  @ApiOperation({ summary: 'Générer la DSF complète (bilan + résultat + TAFIRE + immobilisations)' })
  @HttpCode(HttpStatus.OK)
  generateDsf(
    @Param('companyId') companyId: string,
    @Body() dto: GenerateDsfDto,
  ) {
    return this.service.generateDsf(companyId, dto.fiscal_year_id);
  }
}
