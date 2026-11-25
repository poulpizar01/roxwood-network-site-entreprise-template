-- CreateTable
CREATE TABLE "candidatures" (
    "id" SERIAL NOT NULL,
    "poste" VARCHAR(120) NOT NULL DEFAULT '',
    "prenom" VARCHAR(60) NOT NULL,
    "nom" VARCHAR(60) NOT NULL,
    "discord_id" VARCHAR(22) NOT NULL,
    "pseudo_discord" VARCHAR(100) NOT NULL,
    "motivation" VARCHAR(2000) NOT NULL DEFAULT '',
    "statut" VARCHAR(10) NOT NULL DEFAULT 'recue',
    "entretien_le" TIMESTAMPTZ(6),
    "notes" VARCHAR(2000) NOT NULL DEFAULT '',
    "employe_id" INTEGER,
    "salon_discord_id" VARCHAR(22),
    "piece_identite_cle" VARCHAR(200),
    "piece_identite_url" VARCHAR(512),
    "piece_identite_cle_mini" VARCHAR(200),
    "piece_identite_url_mini" VARCHAR(512),
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidatures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "candidature_votes" (
    "id" SERIAL NOT NULL,
    "candidature_id" INTEGER NOT NULL,
    "compte_id" INTEGER NOT NULL,
    "valeur" VARCHAR(10) NOT NULL,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "candidature_votes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "candidatures_statut_cree_le_idx" ON "candidatures"("statut", "cree_le" DESC);

-- CreateIndex
CREATE INDEX "candidatures_discord_id_idx" ON "candidatures"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "candidature_votes_candidature_id_compte_id_key" ON "candidature_votes"("candidature_id", "compte_id");

-- AddForeignKey
ALTER TABLE "candidature_votes" ADD CONSTRAINT "candidature_votes_candidature_id_fkey" FOREIGN KEY ("candidature_id") REFERENCES "candidatures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

