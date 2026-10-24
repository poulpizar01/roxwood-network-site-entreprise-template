-- CreateTable
CREATE TABLE "sanctions" (
    "id" SERIAL NOT NULL,
    "employe_id" INTEGER NOT NULL,
    "type" VARCHAR(24) NOT NULL,
    "note" VARCHAR(500) NOT NULL DEFAULT '',
    "compte_id" INTEGER,
    "auteur_nom" VARCHAR(64) NOT NULL DEFAULT '',
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sanctions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sanctions_employe_id_cree_le_idx" ON "sanctions"("employe_id", "cree_le" DESC);
