-- AlterTable
ALTER TABLE "evenements_agenda" ADD COLUMN     "absence_decide_le" TIMESTAMPTZ(6),
ADD COLUMN     "absence_motif" VARCHAR(10),
ADD COLUMN     "absence_motif_refus" VARCHAR(200);
