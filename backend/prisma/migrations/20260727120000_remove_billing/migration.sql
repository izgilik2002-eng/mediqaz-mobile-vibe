-- DropForeignKey
ALTER TABLE "subscription_entitlements" DROP CONSTRAINT "subscription_entitlements_user_id_fkey";

-- DropForeignKey
ALTER TABLE "app_store_transactions" DROP CONSTRAINT "app_store_transactions_user_id_fkey";

-- DropForeignKey
ALTER TABLE "google_play_subscription_purchases" DROP CONSTRAINT "google_play_subscription_purchases_user_id_fkey";

-- DropTable
DROP TABLE "subscription_entitlements";

-- DropTable
DROP TABLE "app_store_transactions";

-- DropTable
DROP TABLE "app_store_webhooks";

-- DropTable
DROP TABLE "google_play_subscription_purchases";

-- DropEnum
DROP TYPE "subscription_platform";

-- DropEnum
DROP TYPE "subscription_state";
