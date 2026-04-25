# FTS Chunk Index — Implementation Plan

## Overview

Add a `tsvector` column to the `chunks` table, populate it via a Postgres generated column, and query it in parallel with the existing vector search. Merge and deduplicate results by chunk ID before returning, with FTS results weighted slightly higher than vector results.

**Goal:** Make query results more reliable by not relying purely on semantic/vector search — proper nouns and exact keyword matches will be handled better by FTS.

---

## Step 1: `src/database/client.ts` — Load `unaccent` extension

Import and register `unaccent` alongside `vector`:

```ts
import { unaccent } from "@electric-sql/pglite/contrib/unaccent";

const pglite = new PGlite({
  dataDir: "./dbdata/",
  extensions: { vector, unaccent },
});
```

---

## Step 2: `src/database/schema/chunks.ts` — Add `fts` column

Add a `tsvector` custom column (read-only; it's a generated column, never set on insert):

```ts
import { customType } from "drizzle-orm/pg-core";

const tsvector = customType<{ data: string }>({
  dataType() { return "tsvector"; },
});

// inside chunksTable:
fts: tsvector("fts"),
```

---

## Step 3: `drizzle/0004_fts_index.sql` — New migration

```sql
CREATE EXTENSION IF NOT EXISTS unaccent;

ALTER TABLE chunks
  ADD COLUMN IF NOT EXISTS fts tsvector
    GENERATED ALWAYS AS (to_tsvector('simple', unaccent(content))) STORED;

CREATE INDEX IF NOT EXISTS chunks_fts_idx ON chunks USING GIN (fts);
```

The `unaccent` extension must be created before the generated column that references it. Follows the existing migration style with `IF NOT EXISTS` guards.

**Note:** After updating the schema, regenerate Drizzle metadata via `bun run db:generate` (or equivalent).

---

## Step 4: `src/commands/query.ts` — Parallel FTS + vector, merge, deduplicate

Replace the current single-query flow.

### 4a. Run both queries in parallel (20 candidates each)

```ts
const [vectorResults, ftsResults] = await Promise.all([
  // existing vector query — limit bumped to 20, add chunks.id to select
  db.select({ id: chunksTable.id, filePath, chunkIndex, breadcrumbs, content, similarity })
    .from(chunksTable).innerJoin(filesTable, eq(chunksTable.fileId, filesTable.id))
    .where(gt(similarity, 0))
    .orderBy(desc(similarity)).limit(20),

  // new FTS query
  db.select({
      id: chunksTable.id,
      filePath: filesTable.filePath,
      chunkIndex: chunksTable.chunkIndex,
      breadcrumbs: chunksTable.breadcrumbs,
      content: chunksTable.content,
      rank: sql<number>`ts_rank(${chunksTable.fts}, websearch_to_tsquery('simple', unaccent(${args.query})))`,
    })
    .from(chunksTable).innerJoin(filesTable, eq(chunksTable.fileId, filesTable.id))
    .where(sql`${chunksTable.fts} @@ websearch_to_tsquery('simple', unaccent(${args.query}))`)
    .orderBy(desc(sql`rank`)).limit(20),
]);
```

The FTS query uses raw `args.query` (no instruct prefix) — `websearch_to_tsquery` is lexical, not semantic.

### 4b. Score normalisation (divide by max in each set)

```ts
const maxSimilarity = Math.max(...vectorResults.map(r => r.similarity), 1e-9);
const maxRank       = Math.max(...ftsResults.map(r => r.rank), 1e-9);
```

### 4c. Weighted merge into a `Map<id, result>`, dedup by chunk ID

```ts
const VECTOR_WEIGHT = 0.4;
const FTS_WEIGHT    = 0.6;

const merged = new Map<number, { ...fields, score: number }>();

for (const r of vectorResults) {
  merged.set(r.id, { ...r, score: (r.similarity / maxSimilarity) * VECTOR_WEIGHT });
}
for (const r of ftsResults) {
  const ftsScore = (r.rank / maxRank) * FTS_WEIGHT;
  if (merged.has(r.id)) {
    merged.get(r.id)!.score += ftsScore; // chunk appeared in both — sum scores
  } else {
    merged.set(r.id, { ...r, score: ftsScore });
  }
}

const final = [...merged.values()]
  .sort((a, b) => b.score - a.score)
  .slice(0, 10);
```

### 4d. Output

Unchanged except `row.similarity` → `row.score` in the score label.

---

## File Change Summary

| File | Action |
|---|---|
| `src/database/client.ts` | Add `unaccent` to PGlite extensions |
| `src/database/schema/chunks.ts` | Add `fts tsvector` custom column |
| `drizzle/0004_fts_index.sql` | New migration: `unaccent` extension, generated column, GIN index |
| `src/commands/query.ts` | Parallel queries, score normalisation, weighted merge, dedup |

## No Load Pipeline Changes Required

`load-repository.ts` and `process-file.ts` require zero changes. The generated column is maintained automatically by Postgres on every insert.
