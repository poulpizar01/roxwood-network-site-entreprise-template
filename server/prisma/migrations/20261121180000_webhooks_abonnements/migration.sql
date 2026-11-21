-- CreateTable
CREATE TABLE "abonnements_webhooks" (
    "type" VARCHAR(64) NOT NULL,
    "cle_chiffree" TEXT NOT NULL,
    "cle_nonce" VARCHAR(24) NOT NULL,
    "cle_empreinte" VARCHAR(12) NOT NULL,
    "ancienne_cle_chiffree" TEXT,
    "ancienne_cle_nonce" VARCHAR(24),
    "ancienne_cle_empreinte" VARCHAR(12),
    "ancienne_expire_le" TIMESTAMPTZ(6),
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "abonnements_webhooks_pkey" PRIMARY KEY ("type")
);

-- CreateTable
CREATE TABLE "historique_abonnements_webhooks" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(64) NOT NULL,
    "action" VARCHAR(20) NOT NULL,
    "empreinte" VARCHAR(12),
    "compte_id" INTEGER,
    "acteur_nom" VARCHAR(64) NOT NULL,
    "horodate_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_abonnements_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historique_abonnements_webhooks_type_idx" ON "historique_abonnements_webhooks"("type");

-- AddForeignKey
ALTER TABLE "historique_abonnements_webhooks" ADD CONSTRAINT "historique_abonnements_webhooks_compte_id_fkey" FOREIGN KEY ("compte_id") REFERENCES "comptes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
