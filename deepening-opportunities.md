# Deepening Opportunities

Identified during architecture review (2026-05-03).

---

## 1. `EMBEDDING_DIMS` coupling: `embedder.ts` → `database/schema/chunks.ts`

- **Files:** `src/embedder.ts`, `src/database/schema/chunks.ts`
- **Problem:** Schema imports a model constant. Schema migration needed when model changes, but no guard links them. Changing model = touching unrelated module.
- **Solution:** Move `EMBEDDING_DIMS` (and `MODEL_ID`, `MODEL_DTYPE`) to a shared `src/config.ts`. Schema and embedder both read from there.
- **Benefits:** Locality — model config in one place. Schema stays purely declarative.

---

## 2. `db` singleton: no seam at DB connection level

- **Files:** `src/database/client.ts`, `src/commands/load/load-repository.ts`, `src/query/execute.ts`, `scripts/migrate.ts`, `scripts/query.ts`
- **Problem:** Extension list duplicated in 3 places. `DbLoadRepository` and `executeQuery` import `db` directly — untestable without patching modules. Hardcoded `./dbdata/` path.
- **Solution:** `createDbClient(path?)` factory instead of module-level singleton. Extension list defined once. `DbLoadRepository` and `executeQuery` accept `db` as a param (or via the DI already present).
- **Benefits:** Real seam — integration tests can pass in-memory DB. Locality for extension config.

---

## 3. `executeQuery` monolith: score fusion + re-ranking untestable

- **Files:** `src/query/execute.ts`
- **Problem:** 5 distinct steps (3 parallel queries → score fusion → wikilink re-ranking → per-file pooling → sort) in one function. Score fusion and re-ranking only testable via live DB.
- **Solution:** Extract pure functions: `fuseScores(results, weights)`, `rerankByWikilinks(candidates, topN)`, `poolByFile(candidates, topK)`. Keep `executeQuery` as a thin orchestrator.
- **Benefits:** Leverage — callers get same behaviour. Locality — fusion/re-ranking bugs findable without a DB. Tests can verify scoring logic with plain objects.

---

## 4. Silent breadcrumb loss: chunker builds breadcrumbs, DB stores `[]`

- **Files:** `src/commands/load/process-file.ts`, `src/commands/load/load-repository.ts`
- **Problem:** `Chunk.breadcrumb` computed by chunker, never passed to DB. `replaceFileChunks` hardcodes `breadcrumbs: []`. Data silently dropped.
- **Solution:** Pass `chunk.breadcrumb` through `replaceFileChunks`. One-line fix but requires an interface change.
- **Benefits:** Correctness. `query/execute.ts` displays breadcrumbs — currently always empty.

---

## 5. Header/title construction inline in `processLoadedFile`

- **Files:** `src/commands/load/process-file.ts` lines 57–86
- **Problem:** 30-line conditional string builder embedded mid-pipeline. Not independently testable. Logic for which frontmatter fields → header vs. title is easy to regress quietly.
- **Solution:** Extract `buildDocumentHeader(frontmatter) → {headerPrefix, titleString}`. Pure function, small interface, testable.
- **Benefits:** Leverage — callers don't see the construction logic. Tests can cover frontmatter→header mapping in isolation.

---

## 6. `getFileProcessingState` two-query round trip

- **Files:** `src/commands/load/load-repository.ts`
- **Problem:** Two separate `COUNT(*)` queries to get total vs. embedded chunks. One query with `COUNT(*) FILTER (WHERE embedding IS NOT NULL)` suffices.
- **Solution:** Merge into single conditional aggregation query.
- **Benefits:** Minor perf gain on load.
