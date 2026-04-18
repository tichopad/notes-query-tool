DO $$ BEGIN
  ALTER TABLE "files" ADD COLUMN "attributes" jsonb;
EXCEPTION WHEN duplicate_column THEN NULL;
END $$;