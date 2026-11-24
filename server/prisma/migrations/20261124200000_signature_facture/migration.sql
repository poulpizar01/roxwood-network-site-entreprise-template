-- AlterTable
ALTER TABLE "factures" ADD COLUMN     "signature_discord_id" VARCHAR(22),
ADD COLUMN     "signature_discord_pseudo" VARCHAR(100),
ADD COLUMN     "signature_document_fige" JSONB,
ADD COLUMN     "signature_expire_le" TIMESTAMPTZ(6),
ADD COLUMN     "signature_jeton" VARCHAR(64),
ADD COLUMN     "signature_signee_le" TIMESTAMPTZ(6);

-- CreateIndex
CREATE UNIQUE INDEX "factures_signature_jeton_key" ON "factures"("signature_jeton");

