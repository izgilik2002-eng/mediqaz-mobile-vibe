-- CreateEnum
CREATE TYPE "doctor_specialty" AS ENUM ('therapist', 'pediatrician', 'cardiologist', 'surgeon', 'ent', 'neurologist');

-- CreateEnum
CREATE TYPE "appointment_status" AS ENUM ('recording', 'processing', 'transcribing', 'generating', 'completed', 'failed');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "approved_by_user_id" UUID,
ADD COLUMN     "is_approved" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "specialty" "doctor_specialty";

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL DEFAULT uuidv7(),
    "doctor_id" UUID NOT NULL,
    "status" "appointment_status" NOT NULL DEFAULT 'recording',
    "specialty" "doctor_specialty" NOT NULL,
    "transcript" TEXT,
    "med_card" JSONB,
    "duration_seconds" INTEGER,
    "failure_reason" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "appointments_doctor_id_created_at_idx" ON "appointments"("doctor_id", "created_at");

-- CreateIndex
CREATE INDEX "appointments_status_idx" ON "appointments"("status");

-- CreateIndex
CREATE INDEX "users_is_approved_idx" ON "users"("is_approved");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_approved_by_user_id_fkey" FOREIGN KEY ("approved_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctor_id_fkey" FOREIGN KEY ("doctor_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
