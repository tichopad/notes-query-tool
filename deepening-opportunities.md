# Deepening Opportunities

Identified during architecture review (2026-05-03).

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
