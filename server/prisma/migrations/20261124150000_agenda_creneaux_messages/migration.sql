-- AlterTable
ALTER TABLE "evenements_agenda" ADD COLUMN     "places_max" INTEGER,
ADD COLUMN     "statut" VARCHAR(10) NOT NULL DEFAULT 'confirme';

-- CreateTable
CREATE TABLE "agenda_affectations" (
    "id" SERIAL NOT NULL,
    "evenement_id" INTEGER NOT NULL,
    "compte_id" INTEGER,
    "nom" VARCHAR(100) NOT NULL,
    "chef_equipe" BOOLEAN NOT NULL DEFAULT false,
    "pris_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_affectations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agenda_messages" (
    "id" SERIAL NOT NULL,
    "evenement_id" INTEGER NOT NULL,
    "compte_id" INTEGER,
    "auteur_nom" VARCHAR(100) NOT NULL DEFAULT '',
    "texte" VARCHAR(500) NOT NULL,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agenda_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agenda_affectations_compte_id_idx" ON "agenda_affectations"("compte_id");

-- CreateIndex
CREATE UNIQUE INDEX "agenda_affectations_evenement_id_compte_id_key" ON "agenda_affectations"("evenement_id", "compte_id");

-- CreateIndex
CREATE INDEX "agenda_messages_evenement_id_cree_le_idx" ON "agenda_messages"("evenement_id", "cree_le");

-- AddForeignKey
ALTER TABLE "agenda_affectations" ADD CONSTRAINT "agenda_affectations_evenement_id_fkey" FOREIGN KEY ("evenement_id") REFERENCES "evenements_agenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agenda_messages" ADD CONSTRAINT "agenda_messages_evenement_id_fkey" FOREIGN KEY ("evenement_id") REFERENCES "evenements_agenda"("id") ON DELETE CASCADE ON UPDATE CASCADE;

