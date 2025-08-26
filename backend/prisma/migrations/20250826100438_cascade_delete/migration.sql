-- DropForeignKey
ALTER TABLE "public"."Message" DROP CONSTRAINT "Message_conversationId_fkey";

-- DropForeignKey
ALTER TABLE "public"."conversations" DROP CONSTRAINT "conversations_userId_fkey";

-- AddForeignKey
ALTER TABLE "public"."conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "public"."conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
