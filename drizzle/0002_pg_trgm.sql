CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chunks_content_trgm_idx
  ON chunks USING gin (content gin_trgm_ops);
