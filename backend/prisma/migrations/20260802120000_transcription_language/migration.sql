-- CreateEnum
CREATE TYPE "transcription_language" AS ENUM ('ru', 'kk', 'multi');

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "transcription_language" "transcription_language" NOT NULL DEFAULT 'ru';
