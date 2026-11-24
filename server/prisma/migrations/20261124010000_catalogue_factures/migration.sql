-- Catalogue de prestations (nom + prix) : raccourci de saisie d'un article de facture.
CREATE TABLE "catalogue_factures" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(200) NOT NULL,
    "prix" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "catalogue_factures_pkey" PRIMARY KEY ("id")
);
