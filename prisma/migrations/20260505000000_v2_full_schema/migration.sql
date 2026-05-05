-- ============================================================
--  VISION R+ — Migration v2.0
--  Ajout des modules : Immobilisations, Documents, DSF,
--  Banque, Sync offline, Exports, Indicateurs financiers
-- ============================================================

-- ─────────────────────────────────────────
--  NOUVEAUX ENUMS
-- ─────────────────────────────────────────

CREATE TYPE "DepreciationMethod" AS ENUM ('lineaire', 'degressive');
CREATE TYPE "AssetStatus"        AS ENUM ('en_service', 'cede', 'mis_au_rebut');
CREATE TYPE "DocumentType"       AS ENUM ('facture', 'recu', 'releve_bancaire', 'contrat', 'bon_commande', 'bulletin_salaire', 'autre');
CREATE TYPE "DocumentSource"     AS ENUM ('upload_web', 'scan_mobile', 'email', 'import');
CREATE TYPE "TaxType"            AS ENUM ('tva_collectee', 'tva_deductible', 'is', 'dsf', 'patente', 'tfpb', 'autre');
CREATE TYPE "DeclarationStatus"  AS ENUM ('brouillon', 'calculee', 'validee', 'deposee');
CREATE TYPE "SyncOperation"      AS ENUM ('create', 'update', 'delete');
CREATE TYPE "SyncStatus"         AS ENUM ('pending', 'synced', 'conflict', 'error');
CREATE TYPE "ExportFormat"       AS ENUM ('pdf', 'xlsx', 'csv');
CREATE TYPE "ExportType"         AS ENUM ('bilan', 'compte_resultat', 'grand_livre', 'balance', 'journal', 'dsf', 'tafire', 'immobilisations', 'flux_tresorerie');

-- Étendre AlertType avec bilan_desequilibre
ALTER TYPE "AlertType" ADD VALUE IF NOT EXISTS 'bilan_desequilibre';

-- ─────────────────────────────────────────
--  IMMOBILISATIONS
-- ─────────────────────────────────────────

CREATE TABLE "fixed_assets" (
    "id"                        TEXT NOT NULL,
    "company_id"                TEXT NOT NULL,
    "name"                      TEXT NOT NULL,
    "description"               TEXT,
    "reference"                 TEXT,
    "asset_account_id"          TEXT,
    "depreciation_account_id"   TEXT,
    "accumulated_account_id"    TEXT,
    "acquisition_date"          TIMESTAMP(3) NOT NULL,
    "commissioning_date"        TIMESTAMP(3),
    "gross_value"               DECIMAL(18,2) NOT NULL,
    "residual_value"            DECIMAL(18,2) NOT NULL DEFAULT 0,
    "useful_life_years"         INTEGER NOT NULL,
    "depreciation_method"       "DepreciationMethod" NOT NULL DEFAULT 'lineaire',
    "degressive_rate"           DECIMAL(5,4),
    "status"                    "AssetStatus" NOT NULL DEFAULT 'en_service',
    "disposal_date"             TIMESTAMP(3),
    "disposal_value"            DECIMAL(18,2),
    "disposal_journal_entry_id" TEXT,
    "location"                  TEXT,
    "serial_number"             TEXT,
    "supplier"                  TEXT,
    "is_active"                 BOOLEAN NOT NULL DEFAULT true,
    "created_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fixed_assets_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "depreciation_lines" (
    "id"                   TEXT NOT NULL,
    "asset_id"             TEXT NOT NULL,
    "company_id"           TEXT NOT NULL,
    "fiscal_year_id"       TEXT NOT NULL,
    "period_start"         TIMESTAMP(3) NOT NULL,
    "period_end"           TIMESTAMP(3) NOT NULL,
    "gross_value"          DECIMAL(18,2) NOT NULL,
    "depreciation_amount"  DECIMAL(18,2) NOT NULL,
    "accumulated_amount"   DECIMAL(18,2) NOT NULL,
    "net_book_value"       DECIMAL(18,2) NOT NULL,
    "is_posted"            BOOLEAN NOT NULL DEFAULT false,
    "journal_entry_id"     TEXT,
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "depreciation_lines_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "depreciation_lines_asset_id_fiscal_year_id_key" UNIQUE ("asset_id", "fiscal_year_id")
);

-- ─────────────────────────────────────────
--  DOCUMENTS & PIÈCES JUSTIFICATIVES
-- ─────────────────────────────────────────

CREATE TABLE "documents" (
    "id"                TEXT NOT NULL,
    "company_id"        TEXT NOT NULL,
    "journal_entry_id"  TEXT,
    "uploaded_by"       TEXT NOT NULL,
    "name"              TEXT NOT NULL,
    "original_filename" TEXT NOT NULL,
    "file_url"          TEXT NOT NULL,
    "file_key"          TEXT,
    "mime_type"         TEXT NOT NULL,
    "file_size_bytes"   INTEGER NOT NULL,
    "document_type"     "DocumentType" NOT NULL DEFAULT 'autre',
    "source"            "DocumentSource" NOT NULL DEFAULT 'upload_web',
    "ocr_processed"     BOOLEAN NOT NULL DEFAULT false,
    "ocr_data"          JSONB,
    "ocr_confidence"    DOUBLE PRECISION,
    "note"              TEXT,
    "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
--  DÉCLARATIONS FISCALES
-- ─────────────────────────────────────────

CREATE TABLE "tax_declarations" (
    "id"             TEXT NOT NULL,
    "company_id"     TEXT NOT NULL,
    "fiscal_year_id" TEXT NOT NULL,
    "tax_type"       "TaxType" NOT NULL,
    "period_start"   TIMESTAMP(3) NOT NULL,
    "period_end"     TIMESTAMP(3) NOT NULL,
    "status"         "DeclarationStatus" NOT NULL DEFAULT 'brouillon',
    "computed_data"  JSONB,
    "tax_base"       DECIMAL(18,2),
    "tax_amount"     DECIMAL(18,2),
    "pdf_url"        TEXT,
    "xlsx_url"       TEXT,
    "validated_by"   TEXT,
    "validated_at"   TIMESTAMP(3),
    "submitted_at"   TIMESTAMP(3),
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_declarations_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
--  MAPPING COMPTES → DSF
-- ─────────────────────────────────────────

CREATE TABLE "dsf_mappings" (
    "id"                  TEXT NOT NULL,
    "accounting_system"   "AccountingSystem" NOT NULL,
    "account_code_start"  TEXT NOT NULL,
    "account_code_end"    TEXT,
    "dsf_section"         TEXT NOT NULL,
    "dsf_line"            TEXT NOT NULL,
    "dsf_label"           TEXT NOT NULL,
    "sign"                INTEGER NOT NULL DEFAULT 1,
    "financial_state"     TEXT NOT NULL,
    "note"                TEXT,
    "created_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dsf_mappings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "dsf_mappings_system_code_line_key" UNIQUE ("accounting_system", "account_code_start", "dsf_line")
);

-- ─────────────────────────────────────────
--  BANQUE & RAPPROCHEMENT
-- ─────────────────────────────────────────

CREATE TABLE "bank_accounts" (
    "id"                 TEXT NOT NULL,
    "company_id"         TEXT NOT NULL,
    "name"               TEXT NOT NULL,
    "bank_name"          TEXT NOT NULL,
    "iban"               TEXT,
    "bic"                TEXT,
    "account_number"     TEXT,
    "currency"           "Currency" NOT NULL DEFAULT 'EUR',
    "current_balance"    DECIMAL(18,2) NOT NULL DEFAULT 0,
    "last_reconciled_at" TIMESTAMP(3),
    "is_active"          BOOLEAN NOT NULL DEFAULT true,
    "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "bank_transactions" (
    "id"               TEXT NOT NULL,
    "bank_account_id"  TEXT NOT NULL,
    "company_id"       TEXT NOT NULL,
    "transaction_date" TIMESTAMP(3) NOT NULL,
    "value_date"       TIMESTAMP(3),
    "description"      TEXT NOT NULL,
    "amount"           DECIMAL(18,2) NOT NULL,
    "is_reconciled"    BOOLEAN NOT NULL DEFAULT false,
    "journal_line_id"  TEXT,
    "import_batch"     TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
--  INDICATEURS FINANCIERS
-- ─────────────────────────────────────────

CREATE TABLE "financial_indicators" (
    "id"             TEXT NOT NULL,
    "company_id"     TEXT NOT NULL,
    "fiscal_year_id" TEXT,
    "period"         TEXT NOT NULL,
    "indicator_type" TEXT NOT NULL,
    "value"          DECIMAL(18,2) NOT NULL,
    "computed_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_indicators_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
--  EXPORTS
-- ─────────────────────────────────────────

CREATE TABLE "export_logs" (
    "id"              TEXT NOT NULL,
    "company_id"      TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "fiscal_year_id"  TEXT,
    "export_type"     "ExportType" NOT NULL,
    "format"          "ExportFormat" NOT NULL,
    "period_start"    TIMESTAMP(3),
    "period_end"      TIMESTAMP(3),
    "file_url"        TEXT,
    "file_key"        TEXT,
    "file_size_bytes" INTEGER,
    "status"          TEXT NOT NULL DEFAULT 'pending',
    "error_message"   TEXT,
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "export_logs_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
--  SYNC OFFLINE
-- ─────────────────────────────────────────

CREATE TABLE "sync_queue" (
    "id"             TEXT NOT NULL,
    "device_id"      TEXT NOT NULL,
    "user_id"        TEXT NOT NULL,
    "company_id"     TEXT NOT NULL,
    "operation"      "SyncOperation" NOT NULL,
    "table_name"     TEXT NOT NULL,
    "record_id"      TEXT NOT NULL,
    "payload"        JSONB NOT NULL,
    "client_version" INTEGER NOT NULL DEFAULT 1,
    "status"         "SyncStatus" NOT NULL DEFAULT 'pending',
    "error_message"  TEXT,
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "synced_at"      TIMESTAMP(3),

    CONSTRAINT "sync_queue_pkey" PRIMARY KEY ("id")
);

-- ─────────────────────────────────────────
--  AJOUT COLONNES EXISTANTES
-- ─────────────────────────────────────────

-- Ajouter metadata aux alertes financières
ALTER TABLE "financial_alerts" ADD COLUMN IF NOT EXISTS "metadata" JSONB;

-- Ajouter context aux conversations IA
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "context" JSONB;

-- ─────────────────────────────────────────
--  FOREIGN KEYS
-- ─────────────────────────────────────────

-- fixed_assets
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_asset_account_id_fkey"
    FOREIGN KEY ("asset_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_depreciation_account_id_fkey"
    FOREIGN KEY ("depreciation_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;
ALTER TABLE "fixed_assets" ADD CONSTRAINT "fixed_assets_accumulated_account_id_fkey"
    FOREIGN KEY ("accumulated_account_id") REFERENCES "accounts"("id") ON DELETE SET NULL;

-- depreciation_lines
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_asset_id_fkey"
    FOREIGN KEY ("asset_id") REFERENCES "fixed_assets"("id") ON DELETE CASCADE;
ALTER TABLE "depreciation_lines" ADD CONSTRAINT "depreciation_lines_fiscal_year_id_fkey"
    FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id");

-- documents
ALTER TABLE "documents" ADD CONSTRAINT "documents_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_journal_entry_id_fkey"
    FOREIGN KEY ("journal_entry_id") REFERENCES "journal_entries"("id") ON DELETE SET NULL;
ALTER TABLE "documents" ADD CONSTRAINT "documents_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "users"("id");

-- tax_declarations
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
ALTER TABLE "tax_declarations" ADD CONSTRAINT "tax_declarations_fiscal_year_id_fkey"
    FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id");

-- bank_accounts
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;

-- bank_transactions
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_bank_account_id_fkey"
    FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE CASCADE;
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_journal_line_id_fkey"
    FOREIGN KEY ("journal_line_id") REFERENCES "journal_lines"("id") ON DELETE SET NULL;

-- export_logs
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id");
ALTER TABLE "export_logs" ADD CONSTRAINT "export_logs_fiscal_year_id_fkey"
    FOREIGN KEY ("fiscal_year_id") REFERENCES "fiscal_years"("id") ON DELETE SET NULL;

-- sync_queue
ALTER TABLE "sync_queue" ADD CONSTRAINT "sync_queue_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
ALTER TABLE "sync_queue" ADD CONSTRAINT "sync_queue_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE;

-- ─────────────────────────────────────────
--  INDEX PERFORMANCE
-- ─────────────────────────────────────────

CREATE INDEX "fixed_assets_company_id_idx"        ON "fixed_assets"("company_id");
CREATE INDEX "fixed_assets_status_idx"             ON "fixed_assets"("status");
CREATE INDEX "depreciation_lines_asset_id_idx"     ON "depreciation_lines"("asset_id");
CREATE INDEX "documents_company_id_idx"            ON "documents"("company_id");
CREATE INDEX "documents_journal_entry_id_idx"      ON "documents"("journal_entry_id");
CREATE INDEX "documents_ocr_processed_idx"         ON "documents"("ocr_processed") WHERE "ocr_processed" = false;
CREATE INDEX "tax_declarations_company_id_idx"     ON "tax_declarations"("company_id");
CREATE INDEX "tax_declarations_status_idx"         ON "tax_declarations"("status");
CREATE INDEX "bank_transactions_bank_account_idx"  ON "bank_transactions"("bank_account_id");
CREATE INDEX "bank_transactions_reconciled_idx"    ON "bank_transactions"("is_reconciled");
CREATE INDEX "sync_queue_status_created_idx"       ON "sync_queue"("status", "created_at");
CREATE INDEX "sync_queue_device_id_idx"            ON "sync_queue"("device_id");
CREATE INDEX "export_logs_company_id_idx"          ON "export_logs"("company_id");
CREATE INDEX "financial_indicators_company_idx"    ON "financial_indicators"("company_id");

-- ─────────────────────────────────────────
--  DONNÉES INITIALES — MAPPING DSF OHADA
-- ─────────────────────────────────────────

INSERT INTO "dsf_mappings" ("id", "accounting_system", "account_code_start", "account_code_end", "dsf_section", "dsf_line", "dsf_label", "sign", "financial_state") VALUES
-- BILAN ACTIF
(gen_random_uuid(), 'ohada', '211', '212', 'AI', 'AI20', 'Terrains', 1, 'bilan_actif'),
(gen_random_uuid(), 'ohada', '213', '214', 'AI', 'AI22', 'Bâtiments et aménagements', 1, 'bilan_actif'),
(gen_random_uuid(), 'ohada', '215', '217', 'AI', 'AI24', 'Matériels et mobiliers', 1, 'bilan_actif'),
(gen_random_uuid(), 'ohada', '232', '239', 'AI', 'AI26', 'Immobilisations en cours', 1, 'bilan_actif'),
(gen_random_uuid(), 'ohada', '281', '289', 'AI', 'AI28', 'Amortissements', -1, 'bilan_actif'),
(gen_random_uuid(), 'ohada', '31', '39', 'BI', 'BI30', 'Stocks', 1, 'bilan_actif'),
(gen_random_uuid(), 'ohada', '411', '419', 'BI', 'BI32', 'Clients et comptes rattachés', 1, 'bilan_actif'),
(gen_random_uuid(), 'ohada', '51', '59', 'BI', 'BI38', 'Trésorerie et équivalents', 1, 'bilan_actif'),
-- BILAN PASSIF
(gen_random_uuid(), 'ohada', '101', '109', 'CP', 'CP10', 'Capital social', 1, 'bilan_passif'),
(gen_random_uuid(), 'ohada', '12', '12', 'CP', 'CP14', 'Report à nouveau', 1, 'bilan_passif'),
(gen_random_uuid(), 'ohada', '401', '409', 'DE', 'DE40', 'Dettes fournisseurs', 1, 'bilan_passif'),
(gen_random_uuid(), 'ohada', '43', '44', 'DE', 'DE44', 'Dettes fiscales et sociales', 1, 'bilan_passif'),
-- COMPTE DE RÉSULTAT
(gen_random_uuid(), 'ohada', '70', '79', 'RA', 'RA70', 'Produits d''exploitation', 1, 'resultat'),
(gen_random_uuid(), 'ohada', '60', '69', 'RA', 'RA60', 'Charges d''exploitation', -1, 'resultat'),
-- PCG France — BILAN ACTIF
(gen_random_uuid(), 'pcg_france', '21', '22', 'AI', 'AI20', 'Immobilisations corporelles', 1, 'bilan_actif'),
(gen_random_uuid(), 'pcg_france', '28', '29', 'AI', 'AI28', 'Amortissements et dépréciations', -1, 'bilan_actif'),
(gen_random_uuid(), 'pcg_france', '3', '3', 'BI', 'BI30', 'Stocks', 1, 'bilan_actif'),
(gen_random_uuid(), 'pcg_france', '41', '41', 'BI', 'BI32', 'Clients', 1, 'bilan_actif'),
(gen_random_uuid(), 'pcg_france', '51', '54', 'BI', 'BI38', 'Disponibilités', 1, 'bilan_actif'),
-- PCG France — BILAN PASSIF
(gen_random_uuid(), 'pcg_france', '10', '10', 'CP', 'CP10', 'Capital et réserves', 1, 'bilan_passif'),
(gen_random_uuid(), 'pcg_france', '40', '40', 'DE', 'DE40', 'Fournisseurs', 1, 'bilan_passif'),
(gen_random_uuid(), 'pcg_france', '43', '44', 'DE', 'DE44', 'Dettes fiscales et sociales', 1, 'bilan_passif'),
-- PCG France — RÉSULTAT
(gen_random_uuid(), 'pcg_france', '70', '75', 'RA', 'RA70', 'Produits', 1, 'resultat'),
(gen_random_uuid(), 'pcg_france', '60', '65', 'RA', 'RA60', 'Charges', -1, 'resultat');
