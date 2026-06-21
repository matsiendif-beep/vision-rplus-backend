-- Migration: Add WhatsApp sessions and messages tables
-- Vision R+ v2.1

CREATE TABLE "whatsapp_sessions" (
    "id"              TEXT NOT NULL,
    "user_id"         TEXT NOT NULL,
    "phone_number"    TEXT NOT NULL,
    "is_active"       BOOLEAN NOT NULL DEFAULT true,
    "company_id"      TEXT,
    "last_message_at" TIMESTAMP(3),
    "created_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"      TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whatsapp_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_messages" (
    "id"            TEXT NOT NULL,
    "session_id"    TEXT NOT NULL,
    "direction"     TEXT NOT NULL,
    "content"       TEXT NOT NULL,
    "wa_message_id" TEXT,
    "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whatsapp_messages_pkey" PRIMARY KEY ("id")
);

-- Indexes
CREATE UNIQUE INDEX "whatsapp_sessions_user_id_key"      ON "whatsapp_sessions"("user_id");
CREATE UNIQUE INDEX "whatsapp_sessions_phone_number_key" ON "whatsapp_sessions"("phone_number");

-- Foreign keys
ALTER TABLE "whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "whatsapp_sessions"
    ADD CONSTRAINT "whatsapp_sessions_company_id_fkey"
    FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "whatsapp_messages"
    ADD CONSTRAINT "whatsapp_messages_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "whatsapp_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
