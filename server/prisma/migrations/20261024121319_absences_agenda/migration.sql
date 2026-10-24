-- AlterTable
ALTER TABLE "evenements_agenda" ADD COLUMN     "statut_absence" VARCHAR(10);

-- CreateIndex
CREATE INDEX "evenements_agenda_statut_absence_idx" ON "evenements_agenda"("statut_absence");
