-- DropIndex
DROP INDEX "services_anomalie_maj_le_idx";

-- AlterTable
ALTER TABLE "services" ADD COLUMN     "traite" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "services_anomalie_traite_maj_le_idx" ON "services"("anomalie", "traite", "maj_le");
