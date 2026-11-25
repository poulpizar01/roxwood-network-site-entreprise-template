-- Les questions à choix disparaissent : ce qui en existait devient une réponse courte (les réponses déjà reçues sont du texte, rien n'est perdu).
UPDATE "questions_candidature" SET "type" = 'court' WHERE "type" = 'choix';
ALTER TABLE "questions_candidature" DROP COLUMN "choix";
