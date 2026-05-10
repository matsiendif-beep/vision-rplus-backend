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

  // ── Upload direct multipart → stockage base64 en DB ─────
  async createFromUpload(
    companyId: string,
    userId: string,
    file: Express.Multer.File,
    meta: { document_type?: string; note?: string; journal_entry_id?: string },
  ) {
    const allowed = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('Format non supporté. Utilisez PDF, JPG ou PNG.');
    }
    if (file.size > 10 * 1024 * 1024) {
      throw new BadRequestException('Fichier trop volumineux (max 10 Mo)');
    }

    if (meta.journal_entry_id) {
      const entry = await this.prisma.journalEntry.findFirst({
        where: { id: meta.journal_entry_id, company_id: companyId },
      });
      if (!entry) throw new NotFoundException('Écriture introuvable');
    }

    // Stocker le contenu binaire en base64 dans file_url (data URI)
    const base64 = file.buffer.toString('base64');
    const dataUri = `data:${file.mimetype};base64,${base64}`;

    const doc = await this.prisma.document.create({
      data: {
        company_id:        companyId,
        journal_entry_id:  meta.journal_entry_id ?? null,
        uploaded_by:       userId,
        name:              meta.note ?? file.originalname,
        original_filename: file.originalname,
        file_url:          dataUri,
        file_key:          null,
        mime_type:         file.mimetype,
        file_size_bytes:   file.size,
        document_type:     (meta.document_type ?? 'autre') as any,
        source:            'upload_web',
        note:              meta.note ?? null,
      },
    });

    this.logger.log(`Document uploadé : ${doc.id} | ${file.originalname} | ${file.size} octets`);
    // Retourner sans le data URI (trop volumineux pour la réponse JSON de listing)
    return { ...doc, file_url: undefined, has_file: true };
  }

  // ── Servir le fichier binaire ────────────────────────────
  async getFileBuffer(companyId: string, id: string) {
    const doc = await this.prisma.document.findFirst({
      where: { id, company_id: companyId },
      select: { file_url: true, mime_type: true, original_filename: true },
    });
    if (!doc) throw new NotFoundException('Document introuvable');
    if (!doc.file_url?.startsWith('data:')) {
      throw new BadRequestException('Fichier non disponible');
    }

    // Décoder le data URI
    const base64Data = doc.file_url.split(',')[1];
    const buffer = Buffer.from(base64Data, 'base64');
    return { buffer, mimeType: doc.mime_type, filename: doc.original_filename };
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
