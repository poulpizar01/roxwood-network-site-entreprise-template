-- CreateTable
CREATE TABLE "primes_palier_grades" (
    "id" SERIAL NOT NULL,
    "grade" VARCHAR(20) NOT NULL,
    "domaine" VARCHAR(10) NOT NULL,
    "seuil" INTEGER NOT NULL,
    "prime" INTEGER NOT NULL,

    CONSTRAINT "primes_palier_grades_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "primes_palier_grades_grade_domaine_idx" ON "primes_palier_grades"("grade", "domaine");

-- CreateIndex
CREATE UNIQUE INDEX "primes_palier_grades_grade_domaine_seuil_key" ON "primes_palier_grades"("grade", "domaine", "seuil");
