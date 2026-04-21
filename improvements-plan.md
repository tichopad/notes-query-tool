# Improvements Plan: Name Queries Miss Dedicated Files

## Problem

Query "Who is Rob Pinna?" never returns `testdata/People/Rob Pinna.md` in top 10.

## Root Causes

1. **Frontmatter stripped before embedding** (`src/commands/load.ts:37`). `aliases: [Rob]` and `tags: [people]` never indexed. `attributes` written to DB but unused at query time.
2. **Language mismatch.** File body is Czech; query is English. Cross-lingual cosine weaker than same-language.
3. **Filename signal diluted.** Path prepended at `load.ts:76` but mean-pooled into Czech prose. All `People/*.md` share path prefix; only bare name discriminates, weakly.
4. **Instruct prefix dominates short queries** (`src/commands/query.ts:8-9`). Boilerplate outweighs "Rob Pinna" tokens.
5. **Top-10 cap, no per-file dedup** (`query.ts:49`). Rob's file has ~1 chunk; large project notes fill slots and push it past rank 10.
6. **No lexical channel.** Pure dense vector search. Proper-noun queries are dense retrieval's known weak point.
7. **Minor:** `similarity > 0` filter (`query.ts:47`) structurally wrong, cosmetic here.

## Proposed Fixes (ranked by impact/effort)

### A. Index frontmatter + filename in embedded text
`load.ts:76`: extend prefix with basename (sans `.md`), `title`, `aliases`, `tags` from `attributes`. Re-index. Makes "Rob" alone viable.

### B. Hybrid lexical + dense retrieval (proper fix)
Postgres FTS (`tsvector`) and/or `pg_trgm` over filename basename, frontmatter aliases/tags/title, chunk content. Run alongside vector search. Fuse with Reciprocal Rank Fusion. Solves proper-noun queries structurally.

### C. Filename-match score boost
In `query.ts`: lowercase + strip diacritics both sides. Query tokens hit basename → add bonus (e.g. +0.2) or force include. Cheap heuristic, no FTS needed.

### D. Query-side tweaks
- Drop instruct prefix for short queries (<~6 tokens).
- Or swap in name-focused instruct for "who is X" patterns.
- Normalize (lowercase, NFKD, strip diacritics) on lexical channel.

### E. Per-file diversification
Fetch top 30, apply MMR or cap N chunks per file, trim to 10. Prevents single verbose note crowding out dedicated person note.

### F. Drop `similarity > 0` filter
`query.ts:47`. Use `ORDER BY similarity DESC LIMIT k` only.

### G. Diagnostic `--debug` flag
Print rank/score of specific file even outside top-10. Surfaces regressions.

## Recommended Order

1. **A + C + F** — ~20 lines, likely fixes Rob case.
2. **B** — long-term structural fix. Pure dense will keep failing on proper nouns without it.
3. **D, E, G** — polish.
