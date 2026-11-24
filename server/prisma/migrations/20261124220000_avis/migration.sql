-- CreateTable
CREATE TABLE "avis" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(100) NOT NULL,
    "entreprise" VARCHAR(100),
    "note" SMALLINT NOT NULL,
    "texte" VARCHAR(800) NOT NULL,
    "statut" VARCHAR(10) NOT NULL DEFAULT 'attente',
    "epingle" BOOLEAN NOT NULL DEFAULT false,
    "discord_id" VARCHAR(20) NOT NULL,
    "pseudo_discord" VARCHAR(100) NOT NULL,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "avis_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "avis_statut_epingle_cree_le_idx" ON "avis"("statut", "epingle", "cree_le" DESC);

-- CreateIndex
CREATE INDEX "avis_discord_id_idx" ON "avis"("discord_id");

