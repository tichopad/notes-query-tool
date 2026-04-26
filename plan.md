# Plan: Improve cross-language person-specific retrieval

## Context

Project: `notes-query-tool` — Bun CLI that indexes Markdown notes into PGLite (Drizzle) and queries via three parallel channels fused by weighted score:
- **Vector** (cosine on chunk embeddings, weight 0.3, limit 30)
- **FTS** (`tsvector`/`websearch_to_tsquery` over `unaccent`-folded text, weight 0.4, limit 20)
- **Trigram** (`pg_trgm` `strict_word_similarity` by default, weight 0.3, limit 20, threshold 0.3)

Embedder: `onnx-community/embeddinggemma-300m-ONNX` (768-dim, fp32, mean-pooled, L2-normalized) via `@huggingface/transformers`. Currently called with raw text — no task prefix.

Stored chunk `content` is `headerPrefix + "\n\n" + chunk.text`, where `headerPrefix` is:
```
File: <basename>
Path: <parent dir>
Title: <frontmatter.title>      (optional)
Aliases: <frontmatter.aliases>  (optional)
Tags: <frontmatter.tags>        (optional)
```
The same augmented string is both inserted into `chunks.content` (used by FTS+trigram) AND embedded for the `chunks.embedding` vector.

Bench fixtures live in `bench/fixtures.ts` and are run by `bench/retrieval.test.ts` via `bun test`. The test asserts `MRR >= fx.minMrr` after computing reciprocal rank of the first relevant file in the top 10.

## Failing fixture

```ts
{
  name: "Cross-language person-specific note using subjective language - 'my girlfriend'",
  vectorQuery: "Who is my girlfriend?",
  ftsQuery: "my girlfriend",
  expectedFiles: ["testdata/People/Pavla Polová.md"],
  minMrr: 0.4,
}
```

Observed top-10 (from `bun test bench/retrieval.test.ts`):
```
 1. [1.0000] testdata/People/Petr Hošek.md
 2. [0.5329] testdata/People/Libor Pol.md
 3. [0.5136] testdata/People/Petr Večeřa.md
 4. [0.2866] testdata/People/Kristýna Švábová.md
 5. [0.2857] testdata/People/Ondra Soukup.md
★6. [0.2835] testdata/People/Pavla Polová.md
 7. [0.2814] testdata/People/Joep van der Velden.md
 ...
```
MRR = 0.1667, threshold 0.4 → **fail**.

## Root cause analysis

1. **FTS + trigram channels actively hurt.** `Pavla Polová.md` is fully Czech (`Moje přítelkyně a láska mého života ❤️`) — zero match for the English token "girlfriend". Other notes contain literal English mentions of "girlfriend":
   - `People/Petr Hošek.md`: `[[Pavla Polová]]'s (my girlfriend) best friend.` ← author parenthetically tagging Pavla.
   - `People/Libor Pol.md`: `[[Pavla Polová]]'s father. His girlfriend is [[Hana Sušková]].`
   - `People/Petr Večeřa.md`: `He moved from Ostrava to Opava to live with his girlfriend, Nikol`
   - `Meetings/2026-02-03 1-1 with Dusan Pausly.md`: mention.

2. **Vector channel alone ranks Pavla #5** (probed via `1 - cosineDistance` on the raw query). Even without FTS/trigram, Pavla loses to People notes containing literal "(my girlfriend)" English text. The fundamental bridge "girlfriend" ↔ Czech "přítelkyně" exists semantically but is weaker than the literal-English match in other notes.

3. **Header-prefix dilutes embedding signal.** Probed embeddings (cosine vs query "Who is my girlfriend?"):
   - Pavla bare body `Moje přítelkyně a láska mého života` → 0.6907
   - Pavla full chunk (with `File: Pavla Polová\nPath: People\nAliases: ...\nTags: people\n\n` prefix) → 0.5934
   The same long header is identical across every People chunk, flattening per-chunk variance.

4. **Wikilink mention loss.** Petr Hošek's chunk literally encodes `[[Pavla Polová]]'s (my girlfriend)` — strong evidence that Pavla *is* the girlfriend. Indexing currently treats the wikilink as opaque text, so the signal lands on Petr Hošek's chunk, not Pavla's.

5. **EmbeddingGemma task prefixes not used.** Per the [model card](https://huggingface.co/onnx-community/embeddinggemma-300m-ONNX), the model is trained with prompts:
   - query side: `task: search result | query: <text>`
   - document side: `title: <title|none> | text: <body>`
   
   Project currently embeds raw text. Probed in isolation, prefixes don't flip the failing case alone, but adopting them is generally-correct for multilingual retrieval quality and complementary to the other fixes.

## Other 5 fixtures (must keep passing)

All currently MRR=1.0 except #5 BullMQ (MRR=1.0 by virtue of rank 1, but multiple expected files at ranks 1, 4, 6).

| # | name                                                    | minMrr |
|---|---------------------------------------------------------|--------|
| 1 | EN clean — Digital Signage Colorado deployment          | 0.5    |
| 2 | CZ accented — Armi e-shop kytice                        | 0.5    |
| 3 | CZ unaccented — same target with stripped diacritics    | 0.5    |
| 4 | Typo — misspelled surname Kulcycky (missing j)          | 0.4    |
| 5 | Multi-file — BullMQ across multiple meeting notes       | 0.4    |
| 6 | Cross-language person-specific — 'my girlfriend' (FAIL) | 0.4    |

## Plan: Three phases (chosen scope)

### Phase 1 — Wikilink-aware re-ranking ✅ COMPLETE

Edit `src/query/execute.ts`. After the channel merge but before the per-file max-pool, propagate fractional score from a strong source chunk to its wikilink targets, lifting the file that's actually being talked about.

Algorithm:
1. Add helper `extractWikilinks(content: string): string[]` using regex `/\[\[([^\]|#]+)(?:[|#][^\]]*)?\]\]/g` — return unique trimmed target names (basenames without `.md`).
2. Once per `executeQuery` call, run `SELECT id, file_path FROM files` (small table) and build `Map<basename, filePath>` where basename = `path.basename(file_path, ".md")`. If multiple paths share a basename, map to all of them (Set).
3. After `merged` map is fully populated by all three channels:
   - Build `filePathsInResults: Set<string>` from current `merged` entries.
   - Pick top `LINK_SOURCE_TOP_N = 10` source chunks (by current `score`).
   - For each source chunk:
     - For each wikilink target → resolved `filePath`:
       - Skip if `filePath === source.filePath` (self-link guard).
       - Skip if `filePath` not in `filePathsInResults` (only boost files already candidate; avoids fetching fresh chunks).
       - Track per-target accumulated boost in `boosts: Map<filePath, number>`, capped at `LINK_BOOST_CAP`. Increment by `LINK_BOOST * sourceScore`.
   - Apply: for each chunk in `merged`, if `boosts.has(chunk.filePath)`, add the boost to its `score`.
4. Constants near existing weights: `LINK_BOOST = 0.2`, `LINK_BOOST_CAP = 0.4`, `LINK_SOURCE_TOP_N = 10`. Tune if a non-failing fixture regresses.

No reindex required for Phase 1 — pure ranking logic.

### Phase 2 — EmbeddingGemma task prefixes ✅ COMPLETE

Edit `src/embedder.ts`. Replace the single `(text) => Promise<number[]>` returned by `initEmbedder` with an object exposing two functions:

```ts
export interface Embedder {
  embedQuery(text: string): Promise<number[]>;
  embedDocument(body: string, title?: string | null): Promise<number[]>;
}
```

- `embedQuery(text)` → embed `"task: search result | query: " + text`
- `embedDocument(body, title)` → embed `"title: " + (title?.trim() || "none") + " | text: " + body`

Constants for the prefixes co-located in `embedder.ts`.

Backwards compatibility: keep `initEmbedder` name; change return type. Update all callers:
- `src/commands/load/process-file.ts` — currently calls `deps.embed(augmented)`. Replace with a new dep `embedDocument` and call `embedDocument(bodyForEmbedding, basename)`. See Phase 3 for what `bodyForEmbedding` is.
- `src/query/execute.ts` — `ExecuteQueryOpts.embedder` becomes `embedQuery: (text) => Promise<number[]>` (rename for clarity) OR keep `embedder` typed as a query embedder. Prefer renaming to `embedQuery`.
- `src/commands/query.ts` — pass `embedder.embedQuery`.
- `bench/retrieval.test.ts` — `embed = await initEmbedder()` → `const embedder = await initEmbedder()`; pass `embedder: embedder.embedQuery` to `executeQuery`. Update local variable type in helper signature.
- `src/commands/load/process-file.test.ts` and `decide-file-processing.test.ts` — update mock dep type if they reference `embed`.

Test file references that may need updates (verify via grep): `src/commands/load/process-file.ts`, `src/commands/query.ts`, `bench/retrieval.test.ts`, plus tests.

### Phase 3 — Decouple stored `content` from embedded text ✅ COMPLETE

Edit `src/commands/load/process-file.ts`. Goal: keep header/aliases in stored `content` (so FTS+trigram still index them), but stop diluting the embedding with the same boilerplate prefix.

- Stored `content` (used by FTS, trigram, and result preview): keep the current `augmented = headerPrefix + "\n\n" + chunk.text`.
- Embedded body: pass only `chunk.text` to `embedDocument(chunk.text, titleString)`.
- `titleString`: build from filename + frontmatter title + aliases, e.g.
  ```
  Pavla Polová (aliases: Paja, Pája, Pájinka, Pavlínka; tags: people)
  ```
  This routes the file/alias/tags information into EmbeddingGemma's `title:` slot, where the model is trained to use it without crowding the body vector.
- Empty-body guard: if `chunk.text` is empty after trim, skip embedding (existing chunker shouldn't emit such chunks but be defensive).

### Reindex + verification

After Phase 2/3:
1. `bun run testdata:reindex` (~2–3 min). This script is `rm -rf dbdata && bun run db:migrate && bun run testdata:load`.
2. `bun test bench/retrieval.test.ts` — confirm all 6 fixtures pass and log MRR + top-10 for each.
3. If any non-failing fixture regresses, tune in this order:
   - First try lowering `LINK_BOOST` (0.2 → 0.15 or 0.1).
   - If alias-in-title hurts a meeting fixture, drop aliases from `titleString` and keep just basename + frontmatter title.
   - Last resort: retain header prefix in embedded body but drop aliases from it.
4. `bun run fix && bun run check`.

## Files to edit

| File | Phase | Change |
|------|-------|--------|
| `src/query/execute.ts` | 1, 2 | Wikilink boost logic; rename `embedder` opt → `embedQuery` |
| `src/embedder.ts` | 2 | Return `{embedQuery, embedDocument}` |
| `src/commands/load/process-file.ts` | 2, 3 | Use `embedDocument(body, title)`; build `titleString`; embed bare body, store augmented content |
| `src/commands/query.ts` | 2 | Pass `embedder.embedQuery` |
| `bench/retrieval.test.ts` | 2 | Use `embedder.embedQuery` |
| Any tests referencing the old `embed` shape | 2 | Update mocks |

## Constants (defaults; tune against bench)

```ts
// src/query/execute.ts
const LINK_BOOST = 0.2;
const LINK_BOOST_CAP = 0.4;
const LINK_SOURCE_TOP_N = 10;

// src/embedder.ts
const QUERY_PREFIX = "task: search result | query: ";
const DOC_PREFIX_PREFIX = "title: ";
const DOC_PREFIX_INFIX = " | text: ";
const DEFAULT_TITLE = "none";
```

## Risks and mitigations

- **Hub over-promotion**: a frequently-linked file (e.g. Pavla, common projects) could be lifted unfairly when unrelated chunks happen to mention it. Mitigated by `LINK_SOURCE_TOP_N` (only strong sources contribute) and per-target `LINK_BOOST_CAP`.
- **Fixture #5 (BullMQ) regression**: meeting notes about BullMQ may wikilink to people pages; the boost could elevate `[[Bohdan]]` page over the meetings. The cap and source-top-N keep this bounded; verify in bench.
- **Phase 2/3 reindex breaks until complete**: vector index becomes inconsistent if Phase 2 ships without reindex. Always reindex in the same change.
- **Title slot too long**: if aliases list is huge it could overshadow body. Keep titleString concise (single line, comma-separated, no wikilinks).
- **Frontmatter parsing**: `extractFrontmatter` already runs in `process-file.ts` — reuse, don't re-parse.

## Verification commands

```bash
# Phase 1 only (no reindex needed):
bun test bench/retrieval.test.ts

# Phase 2/3:
bun run testdata:reindex
bun test bench/retrieval.test.ts
bun run fix && bun run check
```

Expected outcome: all 6 fixtures pass, fixture #6 in particular ranks `Pavla Polová.md` in the top 3 (MRR ≥ 0.4, ideally ≥ 0.5).

## Quick reference: where things live

- Channel fusion + per-file max-pool: `src/query/execute.ts:executeQuery`
- Chunking entry: `src/files/chunker.ts:chunkMarkdown` (limit 2000 chars)
- Frontmatter: `src/files/frontmatter.ts:extractFrontmatter`
- Header prefix construction: `src/commands/load/process-file.ts:55-70`
- Embedding call site (load): `src/commands/load/process-file.ts:81-90`
- Embedding call site (query): `src/query/execute.ts:56`
- Bench harness: `bench/retrieval.test.ts`
- Bench seed instructions: comment at top of `bench/fixtures.ts`
- Reindex: `bun run testdata:reindex` (package.json: `rm -rf dbdata && bun run db:migrate && bun run testdata:load`)
- Ad-hoc SQL: `bun db:query "SELECT ..."` (truncates vectors, 200-row cap)
