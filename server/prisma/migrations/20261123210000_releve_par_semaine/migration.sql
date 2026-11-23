-- Un relevé Tablettes appartient à une semaine : avant, le plus récent servait pour toutes (une semaine sans relevé
-- affichait le chiffre d'affaires d'une autre, et un relevé collé après coup changeait les semaines passées).
-- Les relevés déjà enregistrés prennent la semaine de leur import (lundi, calendrier de Paris).
ALTER TABLE "compta_imports" ADD COLUMN "semaine" DATE;
UPDATE "compta_imports" SET "semaine" = date_trunc('week', "importe_le" AT TIME ZONE 'Europe/Paris')::date;
ALTER TABLE "compta_imports" ALTER COLUMN "semaine" SET NOT NULL;
DROP INDEX "compta_imports_type_importe_le_idx";
CREATE INDEX "compta_imports_type_semaine_importe_le_idx" ON "compta_imports"("type", "semaine", "importe_le" DESC);
