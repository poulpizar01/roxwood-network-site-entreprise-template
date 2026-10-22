-- CreateTable
CREATE TABLE "factures_quota_grades" (
    "grade" VARCHAR(20) NOT NULL,
    "quota" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "factures_quota_grades_pkey" PRIMARY KEY ("grade")
);
