-- Fiche employé : notes internes, pièce d'identité (image), et historique écrit par le serveur.
-- AlterTable
ALTER TABLE "employes" ADD COLUMN     "notes" VARCHAR(1000) NOT NULL DEFAULT '',
ADD COLUMN     "piece_identite_cle" VARCHAR(200),
ADD COLUMN     "piece_identite_cle_mini" VARCHAR(200),
ADD COLUMN     "piece_identite_url" VARCHAR(512),
ADD COLUMN     "piece_identite_url_mini" VARCHAR(512);

-- CreateTable
CREATE TABLE "historique_employes" (
    "id" SERIAL NOT NULL,
    "employe_id" INTEGER NOT NULL,
    "type" VARCHAR(12) NOT NULL,
    "texte" VARCHAR(300) NOT NULL,
    "auteur" VARCHAR(100) NOT NULL DEFAULT '',
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "historique_employes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "historique_employes_employe_id_cree_le_idx" ON "historique_employes"("employe_id", "cree_le" DESC);
