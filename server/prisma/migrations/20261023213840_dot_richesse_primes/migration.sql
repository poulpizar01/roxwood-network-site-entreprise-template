-- CreateTable
CREATE TABLE "dot_bareme_richesse" (
    "id" SERIAL NOT NULL,
    "seuil_min" INTEGER NOT NULL,
    "seuil_max" INTEGER NOT NULL,
    "taux" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "dot_bareme_richesse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compta_dot_primes" (
    "id" SERIAL NOT NULL,
    "employe_id" INTEGER NOT NULL,
    "semaine" DATE NOT NULL,
    "montant" INTEGER NOT NULL DEFAULT 0,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "compta_dot_primes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "compta_dot_primes_employe_id_semaine_key" ON "compta_dot_primes"("employe_id", "semaine");

-- Barème de l'impôt sur la richesse de la DOT du serveur (le même pour toutes les entreprises) : à corriger ici ou en base s'il change
INSERT INTO "dot_bareme_richesse" ("seuil_min", "seuil_max", "taux") VALUES
  (1500000, 2499999, 0.02),
  (2500000, 3499999, 0.03),
  (3500000, 4999999, 0.04),
  (5000000, 99000000, 0.05);
