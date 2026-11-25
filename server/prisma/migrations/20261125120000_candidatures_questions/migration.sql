-- Questions du formulaire de candidature (réglables) : la motivation devient la réponse à une question par défaut.
-- CreateTable
CREATE TABLE "questions_candidature" (
    "id" SERIAL NOT NULL,
    "libelle" VARCHAR(120) NOT NULL,
    "type" VARCHAR(6) NOT NULL,
    "choix" JSONB NOT NULL DEFAULT '[]',
    "obligatoire" BOOLEAN NOT NULL DEFAULT true,
    "champ_fiche" VARCHAR(12),
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "questions_candidature_pkey" PRIMARY KEY ("id")
);

-- AlterTable : les réponses remplacent la motivation (reprise des motivations déjà saisies)
ALTER TABLE "candidatures" ADD COLUMN "reponses" JSONB NOT NULL DEFAULT '[]';
UPDATE "candidatures" SET "reponses" = jsonb_build_array(jsonb_build_object('libelle', 'Votre motivation', 'valeur', "motivation")) WHERE "motivation" <> '';
ALTER TABLE "candidatures" DROP COLUMN "motivation";

-- Question par défaut : la motivation, longue et obligatoire (retirable ou modifiable depuis la gestion)
INSERT INTO "questions_candidature" ("libelle", "type", "obligatoire", "position") VALUES ('Votre motivation', 'long', true, 0);
