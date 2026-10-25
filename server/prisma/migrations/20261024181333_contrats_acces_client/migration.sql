-- Accès client (lien à jeton) et liste de bénéficiaires, sur un contrat.
-- AlterTable
ALTER TABLE "contrats" ADD COLUMN     "jeton" VARCHAR(64),
ADD COLUMN     "beneficiaires" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX "contrats_jeton_key" ON "contrats"("jeton");
