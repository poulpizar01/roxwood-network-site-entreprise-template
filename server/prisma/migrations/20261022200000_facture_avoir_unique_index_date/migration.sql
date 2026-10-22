-- Empêche deux avoirs sur la même facture en cas de double requête simultanée (DropIndex puis CreateIndex unique) ;
-- ajoute un index simple sur date_facture pour le tri « toutes provenances » (sans filtre sur source) de
-- GET /api/compta/factures.
DROP INDEX "factures_avoir_de_id_idx";

-- CreateIndex
CREATE UNIQUE INDEX "factures_avoir_de_id_key" ON "factures"("avoir_de_id");

-- CreateIndex
CREATE INDEX "factures_date_facture_idx" ON "factures"("date_facture" DESC);
