-- CreateTable
CREATE TABLE "product_groups" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "title" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_group_items" (
    "userId" UUID NOT NULL,
    "trackedProductId" UUID NOT NULL,
    "groupId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_group_items_pkey" PRIMARY KEY ("userId","trackedProductId")
);

-- CreateTable
CREATE TABLE "product_group_preferences" (
    "userId" UUID NOT NULL,
    "statsPeriod" TEXT NOT NULL DEFAULT '24h',

    CONSTRAINT "product_group_preferences_pkey" PRIMARY KEY ("userId")
);

-- CreateIndex
CREATE INDEX "product_groups_userId_createdAt_idx" ON "product_groups"("userId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "product_group_items_groupId_createdAt_idx" ON "product_group_items"("groupId", "createdAt");

-- AddForeignKey
ALTER TABLE "product_groups" ADD CONSTRAINT "product_groups_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_group_items" ADD CONSTRAINT "product_group_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "product_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_group_items" ADD CONSTRAINT "product_group_items_userId_trackedProductId_fkey" FOREIGN KEY ("userId", "trackedProductId") REFERENCES "product_subscriptions"("userId", "trackedProductId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_group_preferences" ADD CONSTRAINT "product_group_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every product a user tracks becomes a group of its own, titled after the newest title read and created at the moment of the subscription.
WITH converted AS (
    SELECT
        gen_random_uuid() AS "groupId",
        s."userId",
        s."trackedProductId",
        s."createdAt",
        (
            SELECT o."title"
            FROM "price_observations" o
            WHERE o."trackedProductId" = s."trackedProductId"
            ORDER BY o."observedAt" DESC
            LIMIT 1
        ) AS "title"
    FROM "product_subscriptions" s
),
groups AS (
    INSERT INTO "product_groups" ("id", "userId", "title", "createdAt")
    SELECT "groupId", "userId", "title", "createdAt" FROM converted
)
INSERT INTO "product_group_items" ("userId", "trackedProductId", "groupId", "createdAt")
SELECT "userId", "trackedProductId", "groupId", "createdAt" FROM converted;
