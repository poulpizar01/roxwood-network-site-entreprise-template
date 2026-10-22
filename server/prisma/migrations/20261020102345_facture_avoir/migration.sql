-- AlterTable
ALTER TABLE "factures" ADD COLUMN     "avoir_de_id" INTEGER;

-- CreateIndex
CREATE INDEX "factures_avoir_de_id_idx" ON "factures"("avoir_de_id");
