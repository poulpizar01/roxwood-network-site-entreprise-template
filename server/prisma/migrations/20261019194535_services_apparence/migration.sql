-- CreateTable
CREATE TABLE "apparence_images" (
    "cle" VARCHAR(20) NOT NULL,
    "cle_image" VARCHAR(200) NOT NULL,
    "url" VARCHAR(512) NOT NULL,
    "cle_mini" VARCHAR(200) NOT NULL,
    "url_mini" VARCHAR(512) NOT NULL,
    "compte_id" INTEGER,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "apparence_images_pkey" PRIMARY KEY ("cle")
);

-- CreateTable
CREATE TABLE "images_retirees" (
    "id" SERIAL NOT NULL,
    "cle" VARCHAR(200) NOT NULL,
    "url" VARCHAR(512) NOT NULL,
    "cle_mini" VARCHAR(200) NOT NULL,
    "url_mini" VARCHAR(512) NOT NULL,
    "erreur" VARCHAR(300),
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "images_retirees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" SERIAL NOT NULL,
    "service_id" VARCHAR(64) NOT NULL,
    "employe_nom" VARCHAR(120) NOT NULL DEFAULT '',
    "discord_id" VARCHAR(22),
    "employe_id" INTEGER,
    "debut" TIMESTAMPTZ(6) NOT NULL,
    "fin" TIMESTAMPTZ(6),
    "cause_fin" VARCHAR(120) NOT NULL DEFAULT '',
    "fin_source" VARCHAR(8) NOT NULL DEFAULT '',
    "anomalie" VARCHAR(20) NOT NULL DEFAULT '',
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services_etat" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "derniere_lecture" TIMESTAMPTZ(6),
    "nb_reconnus" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "services_etat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "images_retirees_maj_le_idx" ON "images_retirees"("maj_le");

-- CreateIndex
CREATE UNIQUE INDEX "services_service_id_key" ON "services"("service_id");

-- CreateIndex
CREATE INDEX "services_fin_debut_idx" ON "services"("fin", "debut");

-- CreateIndex
CREATE INDEX "services_discord_id_debut_idx" ON "services"("discord_id", "debut");

-- CreateIndex
CREATE INDEX "services_employe_id_idx" ON "services"("employe_id");

-- CreateIndex
CREATE INDEX "services_anomalie_maj_le_idx" ON "services"("anomalie", "maj_le");
