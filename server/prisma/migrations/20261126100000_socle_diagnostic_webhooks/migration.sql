-- Les anciens échecs peuvent contenir des réponses de formulaires.
UPDATE "webhooks_recus"
SET "contenu" = CASE
  WHEN NOT "traite" AND jsonb_typeof("contenu"->'sentAt') = 'string'
    THEN jsonb_build_object('sentAt', "contenu"->'sentAt')
  ELSE '{}'::jsonb
END;

CREATE TABLE "images_envois_inacheves" (
    "cle" VARCHAR(200) NOT NULL,
    "cle_mini" VARCHAR(200) NOT NULL,
    "local" BOOLEAN NOT NULL,
    "reessayer_le" TIMESTAMPTZ(6) NOT NULL,
    CONSTRAINT "images_envois_inacheves_pkey" PRIMARY KEY ("cle")
);
CREATE INDEX "images_envois_inacheves_reessayer_le_idx" ON "images_envois_inacheves"("reessayer_le");
