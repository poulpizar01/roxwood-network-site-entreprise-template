-- Un avoir reprend l'employé de la facture d'origine (le facturé de la personne baisse du montant remboursé) : les
-- avoirs émis avant ce correctif n'en avaient pas, la facture d'origine restait comptée sans que l'avoir la compense.
UPDATE "factures" AS a SET "employe_id" = o."employe_id"
FROM "factures" AS o
WHERE a."avoir_de_id" = o."id" AND a."employe_id" IS NULL AND o."employe_id" IS NOT NULL;
