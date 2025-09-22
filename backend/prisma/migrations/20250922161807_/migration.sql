/*
  Warnings:

  - You are about to drop the `Message` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "public"."Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropTable
DROP TABLE "public"."Message";

-- CreateTable
CREATE TABLE "public"."messages" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "modelId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "messages_modelId_idx" ON "public"."messages"("modelId");

-- CreateIndex
CREATE INDEX "messages_conversationId_modelId_idx" ON "public"."messages"("conversationId", "modelId");

-- AddForeignKey
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
