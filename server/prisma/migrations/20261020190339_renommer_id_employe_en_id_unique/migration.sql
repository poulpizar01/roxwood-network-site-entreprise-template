-- Renomme l'ID employé en ID Unique (terminologie affichée dans Mon compte et Ressources humaines) ; renommage de
-- colonnes, pas de drop/add : les valeurs existantes sont conservées.
ALTER TABLE "employes" RENAME COLUMN "id_employe" TO "id_unique";
ALTER TABLE "employes" RENAME COLUMN "id_employe_normalise" TO "id_unique_normalise";
ALTER INDEX "employes_id_employe_normalise_key" RENAME TO "employes_id_unique_normalise_key";
