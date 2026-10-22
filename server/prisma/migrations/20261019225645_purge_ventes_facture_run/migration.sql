-- DropForeignKey
ALTER TABLE "tableur_archives_lignes" DROP CONSTRAINT "tableur_archives_lignes_archive_id_fkey";

-- AlterTable
ALTER TABLE "remunerations_grades" DROP COLUMN "prime_location_active",
DROP COLUMN "prime_vente_active",
DROP COLUMN "taux";

-- DropTable
DROP TABLE "baremes_primes";

-- DropTable
DROP TABLE "tableur_archives";

-- DropTable
DROP TABLE "tableur_archives_lignes";

-- DropTable
DROP TABLE "tableur_etat";

-- DropTable
DROP TABLE "tableur_lignes";

-- DropTable
DROP TABLE "ventes";

-- DropTable
DROP TABLE "ventes_doublons";

-- CreateTable
CREATE TABLE "factures" (
    "id" SERIAL NOT NULL,
    "source" VARCHAR(12) NOT NULL,
    "id_bot" VARCHAR(100),
    "numero_facture" VARCHAR(100) NOT NULL DEFAULT '',
    "client_nom" VARCHAR(200) NOT NULL DEFAULT '',
    "sous_total" INTEGER NOT NULL DEFAULT 0,
    "livraison" INTEGER NOT NULL DEFAULT 0,
    "reduction" INTEGER NOT NULL DEFAULT 0,
    "total" INTEGER NOT NULL DEFAULT 0,
    "statut_paiement" VARCHAR(20) NOT NULL DEFAULT '',
    "details" JSONB,
    "compte_id" INTEGER,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "factures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "runs" (
    "id" SERIAL NOT NULL,
    "job_id" VARCHAR(100) NOT NULL DEFAULT '',
    "vendeur_nom" VARCHAR(120) NOT NULL DEFAULT '',
    "vendeur_discord_id" VARCHAR(22),
    "employe_id" INTEGER,
    "item_label" VARCHAR(120) NOT NULL DEFAULT '',
    "quantite" INTEGER NOT NULL DEFAULT 0,
    "total_price" INTEGER NOT NULL DEFAULT 0,
    "company_share" INTEGER NOT NULL DEFAULT 0,
    "description" VARCHAR(500) NOT NULL DEFAULT '',
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "factures_id_bot_key" ON "factures"("id_bot");

-- CreateIndex
CREATE INDEX "factures_source_cree_le_idx" ON "factures"("source", "cree_le" DESC);

-- CreateIndex
CREATE INDEX "factures_compte_id_idx" ON "factures"("compte_id");

-- CreateIndex
CREATE INDEX "runs_cree_le_idx" ON "runs"("cree_le" DESC);

-- CreateIndex
CREATE INDEX "runs_employe_id_idx" ON "runs"("employe_id");

