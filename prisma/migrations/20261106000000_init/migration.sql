CREATE TABLE "ChaosExperiment" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "targetService" TEXT NOT NULL,
    "faultType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "durationSeconds" INTEGER NOT NULL DEFAULT 60,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ChaosExperiment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChaosExperiment_createdAt_idx" ON "ChaosExperiment"("createdAt" DESC);