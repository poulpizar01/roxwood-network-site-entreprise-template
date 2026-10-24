/*
  Warnings:

  - You are about to drop the column `type` on the `sanctions` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sanctions" DROP COLUMN "type",
ADD COLUMN     "type_id" INTEGER;

-- CreateTable
CREATE TABLE "types_sanction" (
    "id" SERIAL NOT NULL,
    "nom" VARCHAR(40) NOT NULL,
    "couleur" VARCHAR(7) NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "types_sanction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "types_sanction_nom_key" ON "types_sanction"("nom");

-- AddForeignKey
ALTER TABLE "sanctions" ADD CONSTRAINT "sanctions_type_id_fkey" FOREIGN KEY ("type_id") REFERENCES "types_sanction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
