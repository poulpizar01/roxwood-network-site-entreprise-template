-- Renomme « sens » (on_paie | on_est_paye) en « partie » (client | fournisseur) : même vocabulaire que
-- TypeContrat.partie, plus clair qu'un sens de paiement.
ALTER TABLE "contrats" RENAME COLUMN "sens" TO "partie";
UPDATE "contrats" SET "partie" = CASE "partie" WHEN 'on_paie' THEN 'fournisseur' WHEN 'on_est_paye' THEN 'client' ELSE "partie" END;
