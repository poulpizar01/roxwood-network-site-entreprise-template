-- AlterTable
ALTER TABLE "evenements_agenda" ADD COLUMN     "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "remunerations_grades" ADD COLUMN     "prime_location_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "prime_vente_active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "taux" DOUBLE PRECISION NOT NULL DEFAULT 0.48,
ALTER COLUMN "salaire_fixe" DROP NOT NULL,
ALTER COLUMN "salaire_fixe" DROP DEFAULT;

-- CreateTable
CREATE TABLE "employes" (
    "id" SERIAL NOT NULL,
    "id_employe" VARCHAR(40) NOT NULL,
    "id_employe_normalise" VARCHAR(40) NOT NULL,
    "id_provisoire" BOOLEAN NOT NULL DEFAULT false,
    "prenom" VARCHAR(60) NOT NULL DEFAULT '',
    "nom" VARCHAR(60) NOT NULL DEFAULT '',
    "telephone" VARCHAR(30) NOT NULL DEFAULT '',
    "rib" VARCHAR(60) NOT NULL DEFAULT '',
    "discord_id" VARCHAR(22),
    "discord_pseudo" VARCHAR(100) NOT NULL DEFAULT '',
    "discord_pseudo_normalise" VARCHAR(100),
    "grade" VARCHAR(20) NOT NULL,
    "statut" VARCHAR(8) NOT NULL DEFAULT 'actif',
    "date_arrivee" DATE,
    "date_depart" DATE,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "employes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rh_arrivees_bot" (
    "id" SERIAL NOT NULL,
    "ticket_id" VARCHAR(100) NOT NULL,
    "discord_id" VARCHAR(30) NOT NULL DEFAULT '',
    "nom_recu" VARCHAR(130) NOT NULL DEFAULT '',
    "resultat" VARCHAR(10) NOT NULL,
    "motif" VARCHAR(400) NOT NULL DEFAULT '',
    "employe_id" INTEGER,
    "reponses" JSONB,
    "accepte_le" VARCHAR(40) NOT NULL DEFAULT '',
    "evenement_le" TIMESTAMPTZ(6),
    "recu_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rh_arrivees_bot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventes" (
    "id" SERIAL NOT NULL,
    "numero_vente" VARCHAR(200) NOT NULL DEFAULT '',
    "date_vente" VARCHAR(10) NOT NULL DEFAULT '',
    "identite" VARCHAR(200) NOT NULL DEFAULT '',
    "formateur" VARCHAR(200) NOT NULL DEFAULT '',
    "identite_normalisee" VARCHAR(200) NOT NULL DEFAULT '',
    "formateur_normalise" VARCHAR(200) NOT NULL DEFAULT '',
    "identite_client" VARCHAR(200) NOT NULL DEFAULT '',
    "numero_tel" VARCHAR(200) NOT NULL DEFAULT '',
    "interieur" VARCHAR(200) NOT NULL DEFAULT '',
    "garage" VARCHAR(200) NOT NULL DEFAULT '',
    "garage_indispo" VARCHAR(200) NOT NULL DEFAULT '',
    "garage_refus" VARCHAR(200) NOT NULL DEFAULT '',
    "entreprise_identite" VARCHAR(200) NOT NULL DEFAULT '',
    "id_entreprise" VARCHAR(200) NOT NULL DEFAULT '',
    "type" VARCHAR(10) NOT NULL DEFAULT '',
    "loc" INTEGER,
    "achat" INTEGER NOT NULL DEFAULT 0,
    "semaine" VARCHAR(8) NOT NULL DEFAULT '',
    "compte_id" INTEGER,
    "event_id" VARCHAR(200),
    "employe_id" INTEGER,
    "formateur_employe_id" INTEGER,
    "cree_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ventes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ventes_doublons" (
    "id" SERIAL NOT NULL,
    "ligne_doublon_id" INTEGER NOT NULL,
    "ligne_originale_id" INTEGER NOT NULL,
    "classification" VARCHAR(100) NOT NULL,
    "justification" TEXT NOT NULL,
    "marque_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "marque_par" VARCHAR(100) NOT NULL,

    CONSTRAINT "ventes_doublons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "baremes_primes" (
    "id" SERIAL NOT NULL,
    "type" VARCHAR(10) NOT NULL,
    "seuil" INTEGER NOT NULL,
    "montant" INTEGER NOT NULL,

    CONSTRAINT "baremes_primes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tableur_lignes" (
    "id" SERIAL NOT NULL,
    "ligne_sheet" INTEGER,
    "nom_sheet" VARCHAR(200) NOT NULL,
    "nom_normalise" VARCHAR(200) NOT NULL,
    "grade_sheet" VARCHAR(40) NOT NULL DEFAULT '',
    "nb_ventes" INTEGER NOT NULL DEFAULT 0,
    "nb_locations" INTEGER NOT NULL DEFAULT 0,
    "employe_id" INTEGER,
    "compte_id" INTEGER,
    "maj_le" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tableur_lignes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tableur_etat" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "derniere_sync" TIMESTAMPTZ(6),
    "statut" VARCHAR(10) NOT NULL DEFAULT '',
    "erreur" VARCHAR(500) NOT NULL DEFAULT '',
    "nb_lignes" INTEGER NOT NULL DEFAULT 0,
    "nb_apparies" INTEGER NOT NULL DEFAULT 0,
    "avertissement" VARCHAR(500) NOT NULL DEFAULT '',
    "semaine" VARCHAR(8) NOT NULL DEFAULT '',
    "instantane" JSONB,
    "instantane_du" TIMESTAMPTZ(6),

    CONSTRAINT "tableur_etat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tableur_archives" (
    "id" SERIAL NOT NULL,
    "semaine" VARCHAR(8) NOT NULL,
    "archive_le" TIMESTAMPTZ(6) NOT NULL,
    "donnees_du" TIMESTAMPTZ(6) NOT NULL,
    "en_retard" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "tableur_archives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tableur_archives_lignes" (
    "id" SERIAL NOT NULL,
    "archive_id" INTEGER NOT NULL,
    "ligne_sheet" INTEGER,
    "nom" VARCHAR(200) NOT NULL,
    "grade" VARCHAR(40) NOT NULL DEFAULT '',
    "ventes" INTEGER NOT NULL DEFAULT 0,
    "locations" INTEGER NOT NULL DEFAULT 0,
    "prime_vente" INTEGER NOT NULL DEFAULT 0,
    "prime_locations" INTEGER NOT NULL DEFAULT 0,
    "compte" VARCHAR(100),
    "employe_id" INTEGER,

    CONSTRAINT "tableur_archives_lignes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employes_id_employe_normalise_key" ON "employes"("id_employe_normalise");

-- CreateIndex
CREATE UNIQUE INDEX "employes_discord_id_key" ON "employes"("discord_id");

-- CreateIndex
CREATE UNIQUE INDEX "employes_discord_pseudo_normalise_key" ON "employes"("discord_pseudo_normalise");

-- CreateIndex
CREATE INDEX "employes_statut_grade_idx" ON "employes"("statut", "grade");

-- CreateIndex
CREATE UNIQUE INDEX "rh_arrivees_bot_ticket_id_key" ON "rh_arrivees_bot"("ticket_id");

-- CreateIndex
CREATE INDEX "rh_arrivees_bot_recu_le_idx" ON "rh_arrivees_bot"("recu_le" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ventes_event_id_key" ON "ventes"("event_id");

-- CreateIndex
CREATE INDEX "ventes_semaine_idx" ON "ventes"("semaine");

-- CreateIndex
CREATE INDEX "ventes_identite_normalisee_idx" ON "ventes"("identite_normalisee");

-- CreateIndex
CREATE INDEX "ventes_formateur_normalise_idx" ON "ventes"("formateur_normalise");

-- CreateIndex
CREATE INDEX "ventes_employe_id_idx" ON "ventes"("employe_id");

-- CreateIndex
CREATE UNIQUE INDEX "ventes_doublons_ligne_doublon_id_key" ON "ventes_doublons"("ligne_doublon_id");

-- CreateIndex
CREATE UNIQUE INDEX "baremes_primes_type_seuil_key" ON "baremes_primes"("type", "seuil");

-- CreateIndex
CREATE INDEX "tableur_lignes_employe_id_idx" ON "tableur_lignes"("employe_id");

-- CreateIndex
CREATE INDEX "tableur_lignes_compte_id_idx" ON "tableur_lignes"("compte_id");

-- CreateIndex
CREATE UNIQUE INDEX "tableur_archives_semaine_key" ON "tableur_archives"("semaine");

-- CreateIndex
CREATE INDEX "tableur_archives_lignes_archive_id_idx" ON "tableur_archives_lignes"("archive_id");

-- CreateIndex
CREATE INDEX "tableur_archives_lignes_employe_id_idx" ON "tableur_archives_lignes"("employe_id");

-- AddForeignKey
ALTER TABLE "tableur_archives_lignes" ADD CONSTRAINT "tableur_archives_lignes_archive_id_fkey" FOREIGN KEY ("archive_id") REFERENCES "tableur_archives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Paliers de primes de départ (Comptabilité → Rémunération : à adapter par chaque entreprise)
INSERT INTO "baremes_primes" ("type", "seuil", "montant") VALUES
  ('vente', 20, 10000), ('vente', 40, 15000), ('vente', 60, 20000), ('vente', 80, 25000), ('vente', 100, 30000),
  ('location', 20, 10000), ('location', 40, 30000), ('location', 60, 50000), ('location', 80, 60000), ('location', 100, 70000);
