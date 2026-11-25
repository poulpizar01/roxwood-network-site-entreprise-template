-- Pièces jointes multiples d'une candidature : la pièce d'identité unique (4 colonnes) devient une ligne parmi les pièces demandées.
-- CreateTable
CREATE TABLE "pieces_demandees" (
    "id" SERIAL NOT NULL,
    "libelle" VARCHAR(80) NOT NULL,
    "obligatoire" BOOLEAN NOT NULL DEFAULT true,
    "vers_fiche" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pieces_demandees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pieces_candidature" (
    "id" SERIAL NOT NULL,
    "candidature_id" INTEGER NOT NULL,
    "libelle" VARCHAR(80) NOT NULL,
    "vers_fiche" BOOLEAN NOT NULL DEFAULT false,
    "cle" VARCHAR(200) NOT NULL,
    "url" VARCHAR(512) NOT NULL,
    "cle_mini" VARCHAR(200) NOT NULL,
    "url_mini" VARCHAR(512) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pieces_candidature_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pieces_candidature_candidature_id_idx" ON "pieces_candidature"("candidature_id");

-- AddForeignKey
ALTER TABLE "pieces_candidature" ADD CONSTRAINT "pieces_candidature_candidature_id_fkey" FOREIGN KEY ("candidature_id") REFERENCES "candidatures"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Reprise de l'existant : le réglage « pièce d'identité » (obligatoire / facultative / aucune) devient une pièce demandée « Pièce d'identité »
-- (aucune : pas de ligne), et chaque pièce déjà reçue devient une ligne de pièce jointe qui va sur la fiche
INSERT INTO "pieces_demandees" ("libelle", "obligatoire", "vers_fiche", "position")
SELECT 'Pièce d''identité', COALESCE((SELECT "valeur" FROM "reglages" WHERE "cle" = 'recrutement.piece'), 'obligatoire') <> 'facultative', true, 0
WHERE COALESCE((SELECT "valeur" FROM "reglages" WHERE "cle" = 'recrutement.piece'), 'obligatoire') <> 'aucune';
DELETE FROM "reglages" WHERE "cle" = 'recrutement.piece';

INSERT INTO "pieces_candidature" ("candidature_id", "libelle", "vers_fiche", "cle", "url", "cle_mini", "url_mini")
SELECT "id", 'Pièce d''identité', true, "piece_identite_cle", "piece_identite_url", COALESCE("piece_identite_cle_mini", ''), COALESCE("piece_identite_url_mini", '')
FROM "candidatures" WHERE "piece_identite_cle" IS NOT NULL AND "piece_identite_url" IS NOT NULL;

-- AlterTable
ALTER TABLE "candidatures" DROP COLUMN "piece_identite_cle",
DROP COLUMN "piece_identite_cle_mini",
DROP COLUMN "piece_identite_url",
DROP COLUMN "piece_identite_url_mini";

-- Une question qui remplit un champ de la fiche porte désormais le nom de ce champ (elle se règle dans « La fiche créée à l'acceptation »)
UPDATE "questions_candidature" SET "libelle" = CASE "champ_fiche" WHEN 'telephone' THEN 'Téléphone' WHEN 'rib' THEN 'RIB' WHEN 'idUnique' THEN 'ID Unique' END, "type" = 'court'
WHERE "champ_fiche" IN ('telephone', 'rib', 'idUnique');
