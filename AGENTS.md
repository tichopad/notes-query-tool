This project is a CLI application for indexing and querying Markdown notes using a combination of different search algorithms.
It uses Node.js with native TypeScript type stripping, pnpm for dependency management, and the built-in `node:test` runner.

Always use Node.js and pnpm. Do not use Bun.

- Use `node <file>` instead of `bun <file>` or `ts-node <file>`
- Use `pnpm run test`
- Use `pnpm install`
- Use `pnpm run <script>`
- Use `pnpm exec <package> <command>` instead of `npx <package> <command>` or `bunx <package> <command>`

## Changes verification

Run `pnpm run fix && pnpm run check` after changes to verify them.

## Test data dirs

- Avoid reading testdata/ and dbdata/ directories' contents unless it's explicitly required to finish the task

## Version control

- Use conventional commits

## APIs

- `WebSocket` is a global in Node 22+. Don't use `ws`.
- Use `node:fs/promises` (`readFile`, `writeFile`, `unlink`) for file I/O.
- Use `node:crypto` (`createHash`) for hashing.

## Testing

```ts
// Use built-in test runner and assert module
import { test, describe } from "node:test";
import assert from "node:assert/strict";

test("hello world", () => {
  assert.equal(1, 1);
});
```

## Database

- Use PGLite via Drizzle
- In case of issues with a stale lock (e.g. process didn't close correctly), run `pnpm run db:delete-stale-lock`

### Ad-hoc SQL queries

Run arbitrary SQL against the local PGLite DB (in `./dbdata/`):

```bash
pnpm run db:query "SELECT id, path FROM notes LIMIT 5"
# or via stdin
pnpm run db:query <<'SQL'
SELECT count(*) FROM chunks;
SQL
```

Output is terse TSV designed for agents/scripts. Vector columns are abbreviated.
Row output capped at 200 rows (override with `DB_QUERY_LIMIT`). Multi-statement input supported.

### Test data seeding

- `pnpm testdata:load` to load test data into the DB
- `pnpm testdata:reindex` to drop the DB and re-load test data
