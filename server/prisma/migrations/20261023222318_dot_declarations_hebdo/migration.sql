/*
  Warnings:

  - Added the required column `semaine` to the `compta_dot_ecritures` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "compta_dot_ecritures_type_idx";

-- AlterTable (en deux temps : les lignes déjà en base n'ont pas de semaine, calculée depuis leur date de saisie)
ALTER TABLE "compta_dot_ecritures" ADD COLUMN     "semaine" DATE;
UPDATE "compta_dot_ecritures" SET "semaine" = date_trunc('week', to_date(date_ecriture, 'DD/MM/YYYY'))
  WHERE date_ecriture ~ '^\d{2}/\d{2}/\d{4}$';
UPDATE "compta_dot_ecritures" SET "semaine" = date_trunc('week', CURRENT_DATE) WHERE "semaine" IS NULL;
ALTER TABLE "compta_dot_ecritures" ALTER COLUMN "semaine" SET NOT NULL;

-- CreateTable
CREATE TABLE "compta_dot_declarations" (
    "semaine" DATE NOT NULL,
    "statut" VARCHAR(10) NOT NULL,
    "figee_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "compte_id" INTEGER,
    "resume" JSONB NOT NULL,
    "salaries" JSONB NOT NULL,
    "ecritures" JSONB NOT NULL,

    CONSTRAINT "compta_dot_declarations_pkey" PRIMARY KEY ("semaine")
);

-- CreateIndex
CREATE INDEX "compta_dot_ecritures_semaine_type_idx" ON "compta_dot_ecritures"("semaine", "type");
