-- Fiches de paie : une semaine verrouillée se publie (chaque employé la lit dans « Mon compte ») et se marque payée
-- employé par employé, sans toucher au résumé figé de la déclaration.
ALTER TABLE "compta_dot_declarations" ADD COLUMN "publiee_le" TIMESTAMPTZ(6);

CREATE TABLE "paiements_fiche_dot" (
    "semaine" DATE NOT NULL,
    "employe_id" INTEGER NOT NULL,
    "paye_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "paiements_fiche_dot_pkey" PRIMARY KEY ("semaine","employe_id")
);
