-- CreateTable
CREATE TABLE "disabled_marketplaces" (
    "marketplace" TEXT NOT NULL,
    "disabledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "disabled_marketplaces_pkey" PRIMARY KEY ("marketplace")
);
