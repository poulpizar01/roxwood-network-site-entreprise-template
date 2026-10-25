-- DropIndex
DROP INDEX "types_contrat_nom_key";

-- AlterTable : types non partagés entre clients et fournisseurs. Les types existants (créés avant cette
-- distinction) deviennent « fournisseur » par défaut ; à reclasser à la main si besoin.
ALTER TABLE "types_contrat" ADD COLUMN     "partie" VARCHAR(12) NOT NULL DEFAULT 'fournisseur';
ALTER TABLE "types_contrat" ALTER COLUMN "partie" DROP DEFAULT;

-- CreateIndex
CREATE UNIQUE INDEX "types_contrat_nom_partie_key" ON "types_contrat"("nom", "partie");
