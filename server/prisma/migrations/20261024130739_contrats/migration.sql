-- CreateTable
CREATE TABLE "contrats" (
    "id" SERIAL NOT NULL,
    "partenaire" VARCHAR(100) NOT NULL,
    "objet" VARCHAR(200) NOT NULL,
    "sens" VARCHAR(12) NOT NULL,
    "montant" INTEGER NOT NULL,
    "statut" VARCHAR(12) NOT NULL DEFAULT 'negociation',
    "notes" VARCHAR(500) NOT NULL DEFAULT '',
    "compte_id" INTEGER,
    "ecriture_id" INTEGER,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contrats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contrats_statut_cree_le_idx" ON "contrats"("statut", "cree_le" DESC);
