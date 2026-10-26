-- CreateTable
CREATE TABLE "echeanciers" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "partenaire" VARCHAR(200) NOT NULL DEFAULT '',
    "contrat_id" INTEGER,
    "facture_id" INTEGER,
    "notes" VARCHAR(500) NOT NULL DEFAULT '',
    "compte_id" INTEGER,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "echeanciers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "echeances" (
    "id" SERIAL NOT NULL,
    "echeancier_id" INTEGER NOT NULL,
    "date_prevue" DATE NOT NULL,
    "periode_debut" DATE,
    "periode_fin" DATE,
    "montant" INTEGER NOT NULL,
    "note" VARCHAR(200) NOT NULL DEFAULT '',
    "facture_id" INTEGER,
    "payee_le" TIMESTAMPTZ(6),
    "moyen_paiement" VARCHAR(40) NOT NULL DEFAULT '',
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "echeances_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "echeanciers_contrat_id_key" ON "echeanciers"("contrat_id");

-- CreateIndex
CREATE UNIQUE INDEX "echeanciers_facture_id_key" ON "echeanciers"("facture_id");

-- CreateIndex
CREATE INDEX "echeances_echeancier_id_date_prevue_idx" ON "echeances"("echeancier_id", "date_prevue");

-- CreateIndex
CREATE INDEX "echeances_facture_id_idx" ON "echeances"("facture_id");

-- CreateIndex
CREATE UNIQUE INDEX "echeances_echeancier_id_periode_debut_key" ON "echeances"("echeancier_id", "periode_debut");

-- AddForeignKey
ALTER TABLE "echeanciers" ADD CONSTRAINT "echeanciers_contrat_id_fkey" FOREIGN KEY ("contrat_id") REFERENCES "contrats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echeanciers" ADD CONSTRAINT "echeanciers_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echeances" ADD CONSTRAINT "echeances_echeancier_id_fkey" FOREIGN KEY ("echeancier_id") REFERENCES "echeanciers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "echeances" ADD CONSTRAINT "echeances_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE SET NULL ON UPDATE CASCADE;
