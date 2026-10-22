-- Agenda sur plusieurs jours : ajoute la date de fin (= date de début pour un événement d'un seul jour) et rend les
-- horaires facultatifs (absents quand l'événement dure plusieurs jours).
-- AlterTable
ALTER TABLE "evenements_agenda" ADD COLUMN     "jour_fin" DATE,
ALTER COLUMN "heure_debut" DROP NOT NULL,
ALTER COLUMN "heure_fin" DROP NOT NULL;

UPDATE "evenements_agenda" SET "jour_fin" = "jour" WHERE "jour_fin" IS NULL;

ALTER TABLE "evenements_agenda" ALTER COLUMN "jour_fin" SET NOT NULL;
