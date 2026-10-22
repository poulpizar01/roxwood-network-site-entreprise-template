-- AlterTable
ALTER TABLE "factures" ADD COLUMN "employe_id" INTEGER;

-- CreateIndex
CREATE INDEX "factures_employe_id_idx" ON "factures"("employe_id");
