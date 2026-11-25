-- Empreinte de l'événement monitoring.sale : une reprise du bot ne crée pas une seconde vente (clé unique, plusieurs NULL permis)
ALTER TABLE "runs" ADD COLUMN "id_bot" VARCHAR(60);
CREATE UNIQUE INDEX "runs_id_bot_key" ON "runs"("id_bot");
