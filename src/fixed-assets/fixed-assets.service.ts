import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateFixedAssetDto, UpdateFixedAssetDto, DisposeAssetDto,
} from './dto/fixed-assets.dto';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class FixedAssetsService {
  private readonly logger = new Logger(FixedAssetsService.name);

  constructor(private prisma: PrismaService) {}

  // ── Lister les immobilisations ────────────────────────────
  async findAll(companyId: string) {
    return this.prisma.fixedAsset.findMany({
      where: { company_id: companyId, is_active: true },
      include: {
        asset_account:        { select: { code: true, label: true } },
        depreciation_account: { select: { code: true, label: true } },
        accumulated_account:  { select: { code: true, label: true } },
        depreciation_lines:   { orderBy: { period_start: 'asc' } },
      },
      orderBy: { acquisition_date: 'desc' },
    });
  }

  // ── Détail d'une immobilisation ──────────────────────────
  async findOne(companyId: string, id: string) {
    const asset = await this.prisma.fixedAsset.findFirst({
      where: { id, company_id: companyId },
      include: {
        asset_account:        { select: { code: true, label: true } },
        depreciation_account: { select: { code: true, label: true } },
        accumulated_account:  { select: { code: true, label: true } },
        depreciation_lines:   { orderBy: { period_start: 'asc' } },
      },
    });
    if (!asset) throw new NotFoundException('Immobilisation introuvable');
    return this.enrichWithIndicators(asset);
  }

  // ── Créer une immobilisation ─────────────────────────────
  async create(companyId: string, dto: CreateFixedAssetDto) {
    const asset = await this.prisma.fixedAsset.create({
      data: {
        company_id:               companyId,
        name:                     dto.name,
        description:              dto.description,
        reference:                dto.reference,
        asset_account_id:         dto.asset_account_id,
        depreciation_account_id:  dto.depreciation_account_id,
        accumulated_account_id:   dto.accumulated_account_id,
        acquisition_date:         new Date(dto.acquisition_date),
        commissioning_date:       dto.commissioning_date ? new Date(dto.commissioning_date) : null,
        gross_value:              dto.gross_value,
        residual_value:           dto.residual_value ?? 0,
        useful_life_years:        dto.useful_life_years,
        depreciation_method:      (dto.depreciation_method ?? 'lineaire') as any,
        degressive_rate:          dto.degressive_rate,
        location:                 dto.location,
        serial_number:            dto.serial_number,
        supplier:                 dto.supplier,
      },
    });

    // Générer automatiquement le plan d'amortissement
    await this.generateDepreciationPlan(asset.id, companyId);
    return this.findOne(companyId, asset.id);
  }

  // ── Mettre à jour ─────────────────────────────────────────
  async update(companyId: string, id: string, dto: UpdateFixedAssetDto) {
    await this.findOne(companyId, id);
    return this.prisma.fixedAsset.update({
      where: { id },
      data: dto,
    });
  }

  // ── Céder / Mettre au rebut ───────────────────────────────
  async dispose(companyId: string, id: string, dto: DisposeAssetDto) {
    const asset = await this.findOne(companyId, id);
    if ((asset as any).status !== 'en_service') {
      throw new BadRequestException('Immobilisation déjà cédée ou mise au rebut');
    }
    return this.prisma.fixedAsset.update({
      where: { id },
      data: {
        status:         'cede',
        disposal_date:  new Date(dto.disposal_date),
        disposal_value: dto.disposal_value ?? 0,
      },
    });
  }

  // ── Tableau global amortissements ────────────────────────
  async getDepreciationTable(companyId: string) {
    const lines = await this.prisma.depreciationLine.findMany({
      where: { company_id: companyId },
      include: { asset: { select: { name: true, gross_value: true } } },
      orderBy: [{ fiscal_year_id: 'asc' }, { asset_id: 'asc' }],
    });
    return lines;
  }

  // ── Générer dotations d'un exercice ──────────────────────
  async postDepreciationsForFiscalYear(
    companyId: string,
    fiscalYearId: string,
    userId: string,
  ) {
    const [fiscalYear, lines] = await Promise.all([
      this.prisma.fiscalYear.findFirst({
        where: { id: fiscalYearId, company_id: companyId },
      }),
      this.prisma.depreciationLine.findMany({
        where: { company_id: companyId, fiscal_year_id: fiscalYearId, is_posted: false },
        include: { asset: true },
      }),
    ]);

    if (!fiscalYear) throw new NotFoundException('Exercice introuvable');
    if (lines.length === 0) return { posted: 0, entries: [] };

    const entries: string[] = [];

    for (const line of lines) {
      if (!line.asset.depreciation_account_id || !line.asset.accumulated_account_id) continue;
      if (Number(line.depreciation_amount) === 0) continue;

      const entry = await this.prisma.journalEntry.create({
        data: {
          company_id:    companyId,
          fiscal_year_id: fiscalYearId,
          journal_type:  'od',
          entry_date:    fiscalYear.end_date,
          reference:     `AMO-${new Date().getFullYear()}`,
          libelle:       `Dotation aux amortissements — ${line.asset.name}`,
          status:        'brouillon',
          created_by:    userId,
          total_debit:   line.depreciation_amount,
          total_credit:  line.depreciation_amount,
          lines: {
            create: [
              {
                company_id: companyId,
                account_id: line.asset.depreciation_account_id,
                libelle:    `Dotation — ${line.asset.name}`,
                debit:      line.depreciation_amount,
                credit:     0,
                line_order: 1,
              },
              {
                company_id: companyId,
                account_id: line.asset.accumulated_account_id,
                libelle:    `Amort. cumulés — ${line.asset.name}`,
                debit:      0,
                credit:     line.depreciation_amount,
                line_order: 2,
              },
            ],
          },
        },
      });

      await this.prisma.depreciationLine.update({
        where: { id: line.id },
        data: { is_posted: true, journal_entry_id: entry.id },
      });
      entries.push(entry.id);
    }

    return { posted: entries.length, entries };
  }

  // ── Calcul plan d'amortissement ───────────────────────────
  private async generateDepreciationPlan(assetId: string, companyId: string) {
    const asset = await this.prisma.fixedAsset.findUniqueOrThrow({
      where: { id: assetId },
    });
    const startDate    = asset.commissioning_date ?? asset.acquisition_date;
    const grossValue   = Number(asset.gross_value);
    const residual     = Number(asset.residual_value);
    const depreciable  = grossValue - residual;
    const years        = asset.useful_life_years;

    const fiscalYears = await this.prisma.fiscalYear.findMany({
      where: { company_id: companyId },
      orderBy: { start_date: 'asc' },
    });

    let accumulatedDepreciation = 0;

    for (let yearIndex = 0; yearIndex < years; yearIndex++) {
      const fy = fiscalYears[yearIndex];
      if (!fy) break;

      let annualAmount: number;
      if (asset.depreciation_method === 'degressive' && asset.degressive_rate) {
        const nbv = grossValue - accumulatedDepreciation;
        annualAmount = Math.min(nbv * Number(asset.degressive_rate), depreciable - accumulatedDepreciation);
      } else {
        annualAmount = depreciable / years;
      }
      annualAmount = Math.round(annualAmount * 100) / 100;

      accumulatedDepreciation += annualAmount;
      const netBookValue = grossValue - accumulatedDepreciation;

      // Upsert pour éviter les doublons si plan regénéré
      await this.prisma.depreciationLine.upsert({
        where: { asset_id_fiscal_year_id: { asset_id: assetId, fiscal_year_id: fy.id } },
        create: {
          asset_id:            assetId,
          company_id:          companyId,
          fiscal_year_id:      fy.id,
          period_start:        fy.start_date,
          period_end:          fy.end_date,
          gross_value:         grossValue,
          depreciation_amount: annualAmount,
          accumulated_amount:  accumulatedDepreciation,
          net_book_value:      Math.max(netBookValue, residual),
        },
        update: {
          depreciation_amount: annualAmount,
          accumulated_amount:  accumulatedDepreciation,
          net_book_value:      Math.max(netBookValue, residual),
        },
      });
    }
  }

  // ── Enrichir avec indicateurs calculés ───────────────────
  private enrichWithIndicators(asset: any) {
    const lines = asset.depreciation_lines ?? [];
    const postedLines = lines.filter((l: any) => l.is_posted);
    const totalDepreciated = postedLines.reduce(
      (sum: number, l: any) => sum + Number(l.depreciation_amount), 0,
    );
    return {
      ...asset,
      total_depreciated: totalDepreciated,
      net_book_value_current: Number(asset.gross_value) - totalDepreciated,
      depreciation_rate_pct: asset.gross_value > 0
        ? Math.round((totalDepreciated / Number(asset.gross_value)) * 100)
        : 0,
    };
  }
}
