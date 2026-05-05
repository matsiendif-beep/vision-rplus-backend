import {
  Injectable, NotFoundException, BadRequestException, Logger,
} from '@nestjs/common';
import { ConfigService }    from '@nestjs/config';
import { PrismaService }    from '../prisma/prisma.service';
import { UploadDocumentDto, LinkDocumentDto } from './dto/documents.dto';
import * as crypto from 'crypto';

@Injectable()
export class DocumentsService {
  private readonly logger = new Logger(DocumentsService.name);

  constructor(
    private prisma:  PrismaService,
    private config:  ConfigService,
  ) {}

  // ── Lister les documents ─────────────────────────────────
  async findAll(companyId: string, filters?: { journal_entry_id?: string }) {
    return this.prisma.document.findMany({
      where: {
        company_id:       companyId,
        journal_entry_id: filters?.journal_entry_id,
      },
      include: {
        uploader: { select: { first_name: true, last_name: true } },
      },
      orderBy: { created_at: 'desc' },
    });
  }

  // ── Détail d'un document ─────────────────────────────────
  async findOne(companyId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, company_id: companyId },
      include: {
        uploader:     { select: { first_name: true, last_name: true, email: true } },
        journal_entry: { select: { id: true, libelle: true, entry_date: true } },
      },
    });
    if (!doc) throw new NotFoundException('Document introuvable');
    return doc;
  }

  // ── Enregistrer un document uploadé ─────────────────────
  // Le fichier est déjà uploadé côté frontend (vers S3/Supabase Storage)
  // Ce endpoint enregistre les métadonnées
  async create(
    companyId: string,
    userId: string,
    dto: UploadDocumentDto,
    fileInfo: {
      originalname: string;
      mimetype: string;
      size: number;
      url: string;
      key: string;
    },
  ) {
    if (dto.journal_entry_id) {
      const entry = await this.prisma.journalEntry.findFirst({
        where: { id: dto.journal_entry_id, company_id: companyId },
      });
      if (!entry) throw new NotFoundException('Écriture introuvable');
    }

    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(fileInfo.mimetype)) {
      throw new BadRequestException('Format non supporté. Utilisez PDF, JPG ou PNG.');
    }

    return this.prisma.document.create({
      data: {
        company_id:       companyId,
        journal_entry_id: dto.journal_entry_id,
        uploaded_by:      userId,
        name:             dto.note ?? fileInfo.originalname,
        original_filename: fileInfo.originalname,
        file_url:         fileInfo.url,
        file_key:         fileInfo.key,
        mime_type:        fileInfo.mimetype,
        file_size_bytes:  fileInfo.size,
        document_type:    (dto.document_type ?? 'autre') as any,
        source:           'upload_web',
        note:             dto.note,
      },
    });
  }

  // ── Lier un document à une écriture ─────────────────────
  async linkToEntry(companyId: string, docId: string, dto: LinkDocumentDto) {
    await this.findOne(companyId, docId);
    if (dto.journal_entry_id) {
      const entry = await this.prisma.journalEntry.findFirst({
        where: { id: dto.journal_entry_id, company_id: companyId },
      });
      if (!entry) throw new NotFoundException('Écriture introuvable');
    }
    return this.prisma.document.update({
      where: { id: docId },
      data: { journal_entry_id: dto.journal_entry_id ?? null },
    });
  }

  // ── Supprimer un document ────────────────────────────────
  async delete(companyId: string, id: string) {
    await this.findOne(companyId, id);
    await this.prisma.document.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Marquer OCR traité ───────────────────────────────────
  async saveOcrResult(
    id: string,
    ocrData: {
      montant?: number;
      date?: string;
      fournisseur?: string;
      tva?: number;
      numero_facture?: string;
    },
    confidence: number,
  ) {
    return this.prisma.document.update({
      where: { id },
      data: {
        ocr_processed:  true,
        ocr_data:       ocrData,
        ocr_confidence: confidence,
      },
    });
  }

  // ── Stats documents ──────────────────────────────────────
  async getStats(companyId: string) {
    const [total, pending_ocr, by_type] = await Promise.all([
      this.prisma.document.count({ where: { company_id: companyId } }),
      this.prisma.document.count({
        where: { company_id: companyId, ocr_processed: false, source: 'scan_mobile' },
      }),
      this.prisma.document.groupBy({
        by: ['document_type'],
        where: { company_id: companyId },
        _count: true,
      }),
    ]);
    return { total, pending_ocr, by_type };
  }
}
