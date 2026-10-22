-- Date de facture éditable (remplace cree_le, renommage de colonne : aucune donnée perdue, la date de réception du
-- bot reste la valeur de départ) et date d'échéance de paiement (facultative, jamais fournie par le bot).
ALTER TABLE "factures" RENAME COLUMN "cree_le" TO "date_facture";
ALTER INDEX "factures_source_cree_le_idx" RENAME TO "factures_source_date_facture_idx";
ALTER TABLE "factures" ADD COLUMN "date_echeance" TIMESTAMPTZ(6);
