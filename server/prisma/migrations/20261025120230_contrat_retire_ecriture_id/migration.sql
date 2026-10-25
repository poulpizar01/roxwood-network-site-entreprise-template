-- Un contrat ne verse plus d'écriture DOT à sa clôture (changerStatutContrat) : colonne devenue inutile.
-- AlterTable
ALTER TABLE "contrats" DROP COLUMN "ecriture_id";
