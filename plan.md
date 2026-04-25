# pg_trgm Word-Distance Search Layer — Implementation Plan

## Overview

Add an experimental third search channel to the hybrid query pipeline, using PostgreSQL's `pg_trgm` extension to perform trigram word-distance matching on chunk content. The channel runs in parallel with the existing dense vector and FTS searches, and its score is fused into the final ranking. The choice between `strict_word_similarity` and `word_similarity` is exposed as a CLI flag so we can compare both strategies empirically.

## Current State

- Hybrid query pipeline lives in `src/commands/query.ts:33`. Two channels run in parallel: vector cosine on `chunks.embedding` and FTS via `tsvector` `@@ websearch_to_tsquery`. Scores are normalised by max and merged into a weighted total (vector 0.4 / fts 0.6) at `src/commands/query.ts:11-12`.
- `chunks.content` is already plain `text` and is populated for every chunk (`src/database/schema/chunks.ts:28`). No new column is required for trigrams.
- `chunks.fts` is materialised at insert time in `src/commands/load/load-repository.ts:108` via `to_tsvector('simple', unaccent(content))`.
- PGlite extension wiring lives in `src/database/client.ts:6`. Both `vector` and `unaccent` are loaded via the `extensions` option.
- `pg_trgm` ships with PGlite as a standard contrib module at `node_modules/@electric-sql/pglite/dist/contrib/pg_trgm.js`; no extra dependency required.
- Drizzle migrations live in `drizzle/`. Schema-derived migrations are produced by `bun run db:generate`; raw SQL migrations follow the `0000_*.sql` style (e.g. `drizzle/0000_supreme_baron_strucker.sql:1`).
- The CLI is built on `citty`. `query.ts` already declares `vector` and `fulltext` args (`src/commands/query.ts:19-32`).

## Desired End State

- A `bun run dev query --vs "..." --fts "..."` invocation runs three parallel searches (vector, FTS, trigram) and merges them with weights 0.3 / 0.4 / 0.3.
- A new `--trigram-mode <strict|word>` flag (default `strict`) selects between `strict_word_similarity` (`<<%` / `<<<->`) and `word_similarity` (`<%` / `<<->`) for the trigram channel.
- A GIN `gin_trgm_ops` index on `chunks.content` accelerates the new lookup, used by both operators.
- The "Rob Pinna" failure mode (English query against Czech proper-noun file) returns the dedicated person note in the top 10, validating the proper-noun lexical channel hypothesis.
- Verification: `bun run fix && bun run check` passes; the trigram query path is covered by an executed end-to-end query and inspecting `query_results.yaml`.

## Out of Scope

- Replacing the FTS channel or removing any existing search layer.
- Changing chunking, embedding, or load-side normalisation/preprocessing of content.
- Reciprocal Rank Fusion or other fusion strategy changes.
- Auto-deletion of `dbdata/` from code or scripts; the re-load is a documented manual step.
- Tuning trigram thresholds dynamically per query length, multi-query operator chaining, or other optimisations beyond the experiment.
- Adding the trigram channel to any per-file diversification, MMR, or boosting logic.

---

## Phase 1: Database setup — `pg_trgm` extension and GIN index ✅

### Overview

Register the `pg_trgm` PGlite contrib extension in the client and add a Drizzle migration that creates the extension and a GIN trigram index on `chunks.content`. This phase is purely infrastructural; no application logic changes here.

### Changes

- **`src/database/client.ts`**: Import `pg_trgm` from PGlite contribs and register it alongside `unaccent` and `vector`.

  ```ts
  import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

  const pglite = new PGlite({
    dataDir: "./dbdata/",
    extensions: { unaccent, vector, pg_trgm },
  });
  ```

- **`drizzle/0002_pg_trgm.sql`** (new raw migration, following the `0000_*.sql` extension-only style): create the extension and the GIN index on `chunks.content`.

  ```sql
  CREATE EXTENSION IF NOT EXISTS pg_trgm;--> statement-breakpoint
  CREATE INDEX IF NOT EXISTS chunks_content_trgm_idx
    ON chunks USING gin (content gin_trgm_ops);
  ```

- **`drizzle/meta/_journal.json`** and a corresponding `drizzle/meta/0002_snapshot.json`: append the new migration entry so `drizzle-kit migrate` picks it up. Keep snapshot identical to `0001` since no Drizzle-modelled schema change is involved (the index is hand-rolled SQL outside the ORM model).

### Verification

- [x] `bun run fix && bun run check` passes.
  - `SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';` returns one row.
  - `SELECT indexname FROM pg_indexes WHERE indexname = 'chunks_content_trgm_idx';` returns one row.
- [ ] **Manual**: Re-load notes via `bun run dev load --glob 'testdata/**/*.md'` succeeds with no errors related to extension loading.

> Pause after this phase for manual confirmation before proceeding.

---

## Phase 2: Trigram query channel and three-way fusion ✅

### Overview

Add the third parallel query in `src/commands/query.ts` using `strict_word_similarity` or `word_similarity` (selected by a new `--trigram-mode` flag). Set the trigram threshold per-transaction with `set_limit(0.3)`. Rebalance the weighted merge to vector 0.3 / fts 0.4 / trigram 0.3 and extend the dedup map to incorporate the new channel.

### Changes

- **`src/commands/query.ts`**:

  1. Replace channel weights:

     ```ts
     const VECTOR_WEIGHT = 0.3;
     const FTS_WEIGHT = 0.4;
     const TRIGRAM_WEIGHT = 0.3;
     const TRIGRAM_THRESHOLD = 0.3;
     ```

  2. Add the new flag:

     ```ts
     trigramMode: {
       type: "string",
       alias: "tg",
       description:
         "Trigram operator: 'strict' (strict_word_similarity, <<%) or 'word' (word_similarity, <%)",
       default: "strict",
     },
     ```

     Validate it's one of `"strict" | "word"` early in `run`, throwing on any other value.

  3. Build the trigram SQL fragments based on the mode (using `strict_word_similarity` / `<<%` for `strict` and `word_similarity` / `<%` for `word`). The query uses the same `args.fulltext` string. Use a transaction so `set_limit` applies to the SELECT:

     ```ts
     const trigramFn = mode === "strict" ? "strict_word_similarity" : "word_similarity";
     const trigramOp = mode === "strict" ? sql.raw("<<%") : sql.raw("<%");
     const score = sql<number>`${sql.raw(trigramFn)}(${args.fulltext}, ${chunksTable.content})`;

     const trigramResults = await db.transaction(async (tx) => {
       await tx.execute(sql`SELECT set_limit(${TRIGRAM_THRESHOLD})`);
       return tx
         .select({
           id: chunksTable.id,
           filePath: filesTable.filePath,
           chunkIndex: chunksTable.chunkIndex,
           breadcrumbs: chunksTable.breadcrumbs,
           content: chunksTable.content,
           score,
         })
         .from(chunksTable)
         .innerJoin(filesTable, eq(chunksTable.fileId, filesTable.id))
         .where(sql`${args.fulltext} ${trigramOp} ${chunksTable.content}`)
         .orderBy(desc(score))
         .limit(20);
     });
     ```

     Run it inside the existing `Promise.all` alongside the vector and FTS queries.

  4. Extend normalisation and merge:

     ```ts
     const maxTrigram = Math.max(...trigramResults.map((r) => r.score), 1e-9);

     for (const r of trigramResults) {
       const tgScore = (r.score / maxTrigram) * TRIGRAM_WEIGHT;
       const existing = merged.get(r.id);
       if (existing) {
         existing.score += tgScore;
       } else {
         merged.set(r.id, { ...r, score: tgScore });
       }
     }
     ```

  5. Update the empty-results guard to include `trigramResults.length === 0`.

  6. Remove or update the stray `console.log("ftsResults", ftsResults)` (`src/commands/query.ts:91`) — replace with a single combined diagnostic log of all three channel sizes plus the chosen trigram mode, e.g.
     `console.log(\`channels: vector=${vectorResults.length} fts=${ftsResults.length} trigram=${trigramResults.length} (${mode})\`);`.

### Verification

- [x] `bun run fix && bun run check` passes.
- [ ] `bun run dev query --vs "Who is Rob Pinna?" --fts "Rob Pinna"` returns `testdata/People/Rob Pinna.md` in the top 10 with `--trigram-mode strict` (default).
- [ ] Repeat with `--trigram-mode word`; verify it also returns results without errors and produces a different ordering on at least one query (confirms the flag wires through).
- [ ] Inspect `query_results.yaml`: every result row has a numeric `score`, top-ranked items make sense for the query.
- [ ] **Manual**: Run `EXPLAIN ANALYZE SELECT ... WHERE 'rob pinna' <<% content` against PGlite (via a quick `bun run` script if needed) to confirm the planner uses `chunks_content_trgm_idx`. If it doesn't, document the finding — performance shouldn't be a blocker per the brief, but we want to know.

> Pause after this phase for manual confirmation before proceeding.

---

## Phase 3: Documentation and rollout ✅

### Overview

Document the new flag, the trigram-mode trade-offs, and the manual reset/re-load workflow required to populate the new index over existing data. Update `improvements-plan.md` to mark item B as partially landed.

### Changes

- **`README.md`** (or create one if missing — only if missing): add a short "Search channels" section describing vector / FTS / trigram, the `--trigram-mode` flag, the default threshold (0.3), and a note that the channel is experimental. Document the manual reset procedure:

  ```bash
  rm -rf dbdata/
  bun run db:migrate
  bun run dev load --glob 'notes/**/*.md'
  ```

  Skip this change if no README currently exists and the user prefers no new docs file (confirm with user).

- **`improvements-plan.md`**: under "B. Hybrid lexical + dense retrieval", append a brief note that `pg_trgm` word-distance matching has been added as an experimental third channel; full RRF migration still pending.

### Verification

- [x] `bun run fix && bun run check` passes.
- [ ] **Manual**: re-read the documentation block; the `rm -rf dbdata/` step is unambiguous and the trigram-mode comparison is explained in 1–2 sentences.

---

## References

- Trigram channel entry point: `src/commands/query.ts:33` (current parallel query block at `src/commands/query.ts:47-84`).
- Existing weights to rebalance: `src/commands/query.ts:11-12`.
- Channel-fusion merge loop to extend: `src/commands/query.ts:111-126`.
- PGlite extension registration pattern: `src/database/client.ts:6-12`.
- Migration style references: `drizzle/0000_supreme_baron_strucker.sql:1`, `drizzle/0001_keen_komodo.sql:24`.
- Motivation for the lexical/proper-noun channel: `improvements-plan.md` items B and C.
- PostgreSQL `pg_trgm` docs: https://www.postgresql.org/docs/current/pgtrgm.html (operators `<%`, `<<%`, `<<->`, `<<<->`; `set_limit` / `word_similarity_threshold` GUCs; `gin_trgm_ops` index support).
