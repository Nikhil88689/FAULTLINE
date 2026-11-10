ALTER TABLE "Incident"
ADD COLUMN "occurredAt" TIMESTAMP(3),
ADD COLUMN "latencySamplesMs" JSONB;
