# Deepening Opportunities

Identified during architecture review (2026-05-03).

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
