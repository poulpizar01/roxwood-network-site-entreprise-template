-- Contrats : montant par période (journalier, hebdomadaire, mensuel), date de début et date de fin facultative
-- (reconduction tacite sans elle) ; bénéficiaires dans leur propre table, avec l'ID unique du jeu ; factures reliées
-- à un contrat et aux périodes qu'elles couvrent.

-- CreateTable
CREATE TABLE "contrat_beneficiaires" (
    "id" SERIAL NOT NULL,
    "contrat_id" INTEGER NOT NULL,
    "nom" VARCHAR(80) NOT NULL,
    "id_unique" VARCHAR(12),

    CONSTRAINT "contrat_beneficiaires_pkey" PRIMARY KEY ("id")
);

-- reprise des noms déjà saisis par les clients (sans ID unique : ils ont été tapés à la main) ; un même nom une fois
INSERT INTO "contrat_beneficiaires" ("contrat_id", "nom")
SELECT DISTINCT c."id", LEFT(BTRIM(n.nom), 80)
FROM "contrats" c, UNNEST(c."beneficiaires") AS n(nom)
WHERE BTRIM(n.nom) <> '';

-- AlterTable : date de début reprise de la création du contrat (jour à Paris), hebdomadaire par défaut
ALTER TABLE "contrats" ADD COLUMN "date_debut" DATE,
ADD COLUMN "date_fin" DATE,
ADD COLUMN "periodicite" VARCHAR(12) NOT NULL DEFAULT 'hebdomadaire',
ADD COLUMN "beneficiaires_maj_le" TIMESTAMPTZ(6);
UPDATE "contrats" SET "date_debut" = ("cree_le" AT TIME ZONE 'Europe/Paris')::date;
ALTER TABLE "contrats" ALTER COLUMN "date_debut" SET NOT NULL;
ALTER TABLE "contrats" DROP COLUMN "beneficiaires";

-- AlterTable
ALTER TABLE "factures" ADD COLUMN     "contrat_id" INTEGER,
ADD COLUMN     "periode_debut" DATE,
ADD COLUMN     "periode_fin" DATE;

-- CreateIndex
CREATE INDEX "contrat_beneficiaires_contrat_id_idx" ON "contrat_beneficiaires"("contrat_id");

-- CreateIndex
CREATE UNIQUE INDEX "contrat_beneficiaires_contrat_id_id_unique_key" ON "contrat_beneficiaires"("contrat_id", "id_unique");

-- CreateIndex
CREATE INDEX "factures_contrat_id_idx" ON "factures"("contrat_id");

-- AddForeignKey
ALTER TABLE "factures" ADD CONSTRAINT "factures_contrat_id_fkey" FOREIGN KEY ("contrat_id") REFERENCES "contrats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contrat_beneficiaires" ADD CONSTRAINT "contrat_beneficiaires_contrat_id_fkey" FOREIGN KEY ("contrat_id") REFERENCES "contrats"("id") ON DELETE CASCADE ON UPDATE CASCADE;
