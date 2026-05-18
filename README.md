# notes-query-tool

**Prerequisites:** Node.js >= 24, pnpm >= 10

Load and index notes:
`pnpm run dev load --glob "testdata/**/*.md"`

Query notes:
`pnpm run dev query --vector/-v <semantic query> --fulltext/-f <keyword query>`

Both `--vector` and `--fulltext` flags are required.

An optional `--trigram` / `-g` flag passes a separate plain-text query to the trigram leg. When omitted, the trigram leg falls back to the `--fulltext` value (preserving existing behaviour). Use this when `--fulltext` contains PostgreSQL websearch syntax (`OR`, `-word`, `"phrases"`) that would corrupt trigram scoring.

An optional `--trigram-mode` / `-t` flag selects the trigram operator: `strict` (default, uses `strict_word_similarity`) or `word` (uses `word_similarity`).

## Search channels

Three parallel channels run on every query and are fused by weighted score (vector 0.3 / FTS 0.4 / trigram 0.3):

- **Vector** — dense cosine similarity on chunk embeddings. Best for semantic / paraphrase queries.
- **FTS** — PostgreSQL full-text search via `tsvector`/`websearch_to_tsquery`. Supports websearch syntax: `OR`, `-word`, `"exact phrase"`. Best for keyword matching.
- **Trigram** *(experimental)* — `pg_trgm` word-distance matching on raw chunk content via `strict_word_similarity` (default) or `word_similarity`. Uses `--trigram` text (or `--fulltext` if not specified). Best for proper-noun and lexical queries that FTS tokenisation misses.

The trigram threshold is fixed at 0.3. Use `--trigram-mode strict` for precision (fewer but higher-confidence matches) or `--trigram-mode word` for recall (more matches, looser).

### Re-loading notes after a fresh database

If you need to reset the database (e.g. after schema migrations), run:

```bash
rm -rf dbdata/
pnpm run dev load --glob 'notes/**/*.md'
```

## Development

### Ad-hoc SQL queries

Run arbitrary SQL against the local PGLite DB (in `./dbdata/`):

```bash
pnpm run db:query "SELECT id, path FROM notes LIMIT 5"
# or via stdin
pnpm run db:query <<'SQL'
SELECT count(*) FROM chunks;
SQL
```

Output is terse TSV designed for agents/scripts. Vector columns are abbreviated. Row output capped at 200 rows (override with `DB_QUERY_LIMIT`). Multi-statement input supported.

## Examples

```sh
# Full flags
pnpm run dev query --vector "Who is my girlfriend and what does she like?" --fulltext "girlfriend interests hobbies"

# Short aliases
pnpm run dev query -v "What are my long-term career goals?" -f "career goals plans"

# Mixed
pnpm run dev query --vector "Summarize my thoughts on stoicism" -f "stoicism notes"

# Split --fulltext (websearch syntax) from --trigram (plain text)
pnpm run dev query -v "async programming patterns" -f "javascript OR python" -g "javascript"

# FTS with phrase exclusion; trigram stays clean
pnpm run dev query -v "nutrition advice" -f '"meal prep" -fast food' -g "meal prep"
```
