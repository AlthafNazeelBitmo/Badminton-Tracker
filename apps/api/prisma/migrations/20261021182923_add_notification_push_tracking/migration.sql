-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "pushedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "notifications_pushedAt_createdAt_idx" ON "notifications"("pushedAt", "createdAt");
