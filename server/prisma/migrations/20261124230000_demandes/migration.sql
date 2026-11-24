-- CreateTable
CREATE TABLE "demandes" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "statut" VARCHAR(10) NOT NULL DEFAULT 'nouvelle',
    "nom" VARCHAR(100) NOT NULL,
    "discord_id" VARCHAR(22) NOT NULL,
    "pseudo_discord" VARCHAR(100) NOT NULL,
    "entreprise_nom" VARCHAR(100),
    "contact_email" VARCHAR(200),
    "contact_telephone" VARCHAR(30),
    "prestation" VARCHAR(120),
    "date_souhaitee" VARCHAR(100),
    "budget" VARCHAR(60),
    "message" VARCHAR(2000) NOT NULL DEFAULT '',
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "salon_discord_id" VARCHAR(22),
    "contrat_id" INTEGER,
    "pris_en_charge_par_id" INTEGER,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "demandes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demandes_statut_cree_le_idx" ON "demandes"("statut", "cree_le" DESC);

-- CreateIndex
CREATE INDEX "demandes_discord_id_idx" ON "demandes"("discord_id");

