-- CreateTable
CREATE TABLE "runs_quota_grades" (
    "grade" VARCHAR(20) NOT NULL,
    "quota" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "runs_quota_grades_pkey" PRIMARY KEY ("grade")
);
