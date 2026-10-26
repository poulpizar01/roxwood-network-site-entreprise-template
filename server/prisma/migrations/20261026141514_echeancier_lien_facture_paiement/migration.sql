-- AlterTable
ALTER TABLE "echeanciers" DROP COLUMN "date_echeance",
DROP COLUMN "date_facture",
DROP COLUMN "details",
DROP COLUMN "livraison",
DROP COLUMN "numero_facture",
DROP COLUMN "reduction",
DROP COLUMN "sous_total",
ADD COLUMN     "facture_id" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "echeanciers_facture_id_key" ON "echeanciers"("facture_id");

-- AddForeignKey
ALTER TABLE "echeanciers" ADD CONSTRAINT "echeanciers_facture_id_fkey" FOREIGN KEY ("facture_id") REFERENCES "factures"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
