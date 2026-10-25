-- États « en négociation » et « annulé » supprimés : les contrats en négociation deviennent « en cours »,
-- les contrats annulés (sans écriture DOT) disparaissent.
DELETE FROM "contrats" WHERE "statut" = 'annule';
UPDATE "contrats" SET "statut" = 'actif' WHERE "statut" = 'negociation';

-- AlterTable
ALTER TABLE "contrats" ADD COLUMN     "type_id" INTEGER,
ALTER COLUMN "statut" SET DEFAULT 'actif';

-- CreateTable
CREATE TABLE "types_contrat" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(40) NOT NULL,
    "couleur" VARCHAR(7) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "types_contrat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "types_contrat_nom_key" ON "types_contrat"("nom");

-- AddForeignKey
ALTER TABLE "contrats" ADD CONSTRAINT "contrats_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "types_contrat"("id") ON DELETE SET NULL ON UPDATE CASCADE;
