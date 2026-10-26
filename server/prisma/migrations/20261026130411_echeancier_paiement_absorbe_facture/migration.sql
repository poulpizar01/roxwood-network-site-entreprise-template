/*
  Warnings:

  - You are about to drop the column `facture_id` on the `echeanciers` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "echeanciers" DROP CONSTRAINT "echeanciers_facture_id_fkey";

-- DropIndex
DROP INDEX "echeanciers_facture_id_key";

-- AlterTable
ALTER TABLE "echeanciers" DROP COLUMN "facture_id",
ADD COLUMN     "date_echeance" TIMESTAMPTZ(6),
ADD COLUMN     "date_facture" TIMESTAMPTZ(6),
ADD COLUMN     "details" JSONB,
ADD COLUMN     "livraison" INTEGER,
ADD COLUMN     "numero_facture" VARCHAR(100),
ADD COLUMN     "reduction" INTEGER,
ADD COLUMN     "sous_total" INTEGER;
