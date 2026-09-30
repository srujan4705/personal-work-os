-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'PUNCH_REMINDER';

-- AlterTable
ALTER TABLE "user_settings" ADD COLUMN     "punchReminderEnabled" BOOLEAN NOT NULL DEFAULT false;
