-- CreateTable
CREATE TABLE "proxy_reputations" (
    "server" TEXT NOT NULL,
    "marketplace" TEXT NOT NULL,
    "successes" DOUBLE PRECISION NOT NULL,
    "failures" DOUBLE PRECISION NOT NULL,
    "failureStreak" INTEGER NOT NULL,
    "lastOutcome" TEXT NOT NULL,
    "lastAttemptAt" TIMESTAMP(3) NOT NULL,
    "cooldownUntil" TIMESTAMP(3),

    CONSTRAINT "proxy_reputations_pkey" PRIMARY KEY ("server","marketplace")
);

-- AddForeignKey
ALTER TABLE "proxy_reputations" ADD CONSTRAINT "proxy_reputations_server_fkey" FOREIGN KEY ("server") REFERENCES "proxies"("server") ON DELETE CASCADE ON UPDATE CASCADE;

