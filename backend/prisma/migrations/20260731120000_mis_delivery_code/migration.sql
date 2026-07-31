-- AlterTable
ALTER TABLE "users" ADD COLUMN     "mis_delivery_code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "users_mis_delivery_code_key" ON "users"("mis_delivery_code");
