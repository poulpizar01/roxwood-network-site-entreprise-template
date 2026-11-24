-- CreateTable
CREATE TABLE "services_vitrine" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(60) NOT NULL,
    "resume" VARCHAR(120) NOT NULL DEFAULT '',
    "description" VARCHAR(400) NOT NULL DEFAULT '',
    "inclus" JSONB NOT NULL DEFAULT '[]',
    "etiquette_ids" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "position" INTEGER NOT NULL,
    "masque" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "services_vitrine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "etiquettes_services" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(40) NOT NULL,
    "couleur" VARCHAR(7) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "etiquettes_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "postes_ouverts" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(80) NOT NULL,
    "nombre" INTEGER NOT NULL DEFAULT 1,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "postes_ouverts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "etiquettes_services_nom_key" ON "etiquettes_services"("nom");

