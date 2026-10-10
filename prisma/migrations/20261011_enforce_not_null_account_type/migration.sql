-- Migration: Enforce NOT NULL and DEFAULT on accountType
-- Created: 2026-10-11

-- Set default 'STUDENT' for any remaining NULL values
UPDATE "user"
SET "accountType" = 'STUDENT'
WHERE "accountType" IS NULL;

-- Alter column to NOT NULL with DEFAULT 'STUDENT'
ALTER TABLE "user" 
ALTER COLUMN "accountType" SET NOT NULL,
ALTER COLUMN "accountType" SET DEFAULT 'STUDENT';
