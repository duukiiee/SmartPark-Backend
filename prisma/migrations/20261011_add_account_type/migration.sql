-- Migration: Add accountType column to user table
-- Created: 2026-10-11

-- Add accountType as nullable column
ALTER TABLE "user" ADD COLUMN IF NOT EXISTS "accountType" TEXT;

-- Safe Regex Backfill for STUDENT accounts (e.g. 24-1474)
UPDATE "user"
SET "accountType" = 'STUDENT'
WHERE "schoolId" ~ '^\d{2}-\d{4}$';

-- Safe Regex Backfill for EMPLOYEE accounts (e.g. AV-1234567, AD-0000001)
UPDATE "user"
SET "accountType" = 'EMPLOYEE'
WHERE "schoolId" ~ '^[A-Za-z]{2}-\d{7}$';
