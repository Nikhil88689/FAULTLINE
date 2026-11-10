CREATE TABLE "Incident" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "severity" TEXT NOT NULL,
    "affectedServices" TEXT[] NOT NULL,
    "rootCause" TEXT NOT NULL,
    "failureConfiguration" JSONB NOT NULL,
    "recoveryActions" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "finalOutcome" TEXT NOT NULL,
    "metrics" JSONB NOT NULL,
    "simulationStartMs" INTEGER NOT NULL,
    "simulationEndMs" INTEGER NOT NULL,
    "events" JSONB NOT NULL,
    "replayFrames" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Incident_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Incident_timestamp_idx" ON "Incident"("timestamp" DESC);
CREATE INDEX "Incident_severity_timestamp_idx" ON "Incident"("severity", "timestamp" DESC);
