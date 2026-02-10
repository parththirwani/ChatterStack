-- AlterTable
ALTER TABLE "public"."users" ADD COLUMN     "profile" JSONB DEFAULT '{}',
ADD COLUMN     "profileUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
