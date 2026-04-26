# Startup Migrations Implementation Plan

## Overview

Run Drizzle migrations automatically at CLI startup so the locally-distributed standalone tool is usable without a manual `bun run db:migrate` step. Output stays silent on success and only surfaces errors, matching the project's terse text-only output style.

## Current State

- `src/database/client.ts:7-18` creates the singleton PGlite + Drizzle DB. No migration call.
- `src/main.ts:16-18` `setup()` awaits `db.$client.waitReady` only — migrations are not applied here.
- `scripts/migrate.ts:1-21` duplicates the PGlite/Drizzle bootstrap and calls `migrate(db, { migrationsFolder: "./drizzle" })` with a hardcoded cwd-relative path, then logs `"Migrations applied successfully."`.
- Migrations folder `drizzle/` holds `0000_*.sql`, `0001_*.sql`, `0002_pg_trgm.sql` + `meta/_journal.json`. `0002` is hand-authored.
- Users today must run `bun run db:migrate` (or `testdata:reindex`) explicitly. README.md:23-31 documents this manual step.
- Output convention is plain `console.log` / `console.error`. No logger lib, no spinners, no colors.

## Desired End State

- Running any CLI subcommand (`load`, `query`) applies pending migrations before the command body runs.
- On success: zero migration-related output.
- On failure: error printed to `stderr`, process exits non-zero, DB client closed.
- Migrations folder is resolved via `import.meta.url` so it works regardless of process cwd.
- A single shared `runMigrations(db)` helper is used by both startup and the standalone `scripts/migrate.ts`.
- `bun run db:migrate` continues to work as an explicit/manual entry point.

### Verification

- Fresh DB: `rm -rf dbdata && bun dev query --help` exits 0 with no migration output, and `dbdata/` contains an applied schema (verifiable via `bun db:query "SELECT count(*) FROM __drizzle_migrations"` returning 3).
- Re-run with up-to-date DB: still no output.
- Forced failure (e.g. corrupt journal): error printed, non-zero exit.
- `bun run db:migrate` still works standalone.
- `bun run fix && bun run check` passes.

## Out of Scope

- Standalone-binary packaging concerns (e.g. `bun build --compile` embedding SQL files).
- Centralizing the hardcoded `./dbdata/` path across `client.ts`, `scripts/migrate.ts`, `scripts/query.ts`.
- Adding a logger abstraction or color output.
- Documenting migration authoring workflow.

---

## Phase 1: Extract shared `runMigrations` helper ✅

### Overview

Create a single migration runner used by both startup and the standalone script. Resolve the migrations folder relative to the source file rather than cwd.

### Changes

- **`src/database/migrate.ts`** (new): export `runMigrations(db)` that calls `migrate(db, { migrationsFolder })` where `migrationsFolder` is computed via `fileURLToPath(new URL("../../drizzle", import.meta.url))`. No console output on success — caller decides.

  ```ts
  import { fileURLToPath } from "node:url";
  import type { PgliteDatabase } from "drizzle-orm/pglite";
  import { migrate } from "drizzle-orm/pglite/migrator";

  const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

  export async function runMigrations(db: PgliteDatabase): Promise<void> {
    await migrate(db, { migrationsFolder });
  }
  ```

- **`scripts/migrate.ts`**: replace inline `migrate(...)` call with `runMigrations(db)` import. Keep the `console.log("Migrations applied successfully.")` line here (this is the explicit/manual entry point — output is appropriate for a script the user invoked deliberately). Keep its own PGlite client (script must own its lifecycle).

### Verification

- [x] `bun run fix && bun run check` passes.
- [x] `rm -rf dbdata && bun run db:migrate` prints `Migrations applied successfully.` and exits 0.
- [x] `bun db:query "SELECT count(*) FROM __drizzle_migrations"` returns 3.
- [x] `bun run db:migrate` a second time is a no-op (no error, exits 0).
- [ ] **Manual**: run `bun run db:migrate` from a different cwd (e.g. `cd /tmp && bun /full/path/to/scripts/migrate.ts`) — succeeds (proves `import.meta.url`-relative path).

> Pause after this phase for manual confirmation before proceeding.

---

## Phase 2: Wire migrations into CLI startup ⏳

### Overview

Call `runMigrations` inside `src/main.ts` `setup()` so every subcommand benefits. Silent on success; error path leverages existing process-level handlers.

### Changes

- **`src/main.ts`**: in `setup()`, after `await db.$client.waitReady`, call `await runMigrations(db)`. No success log. Errors propagate; citty/Bun will surface them, and the existing `unhandledRejection` / `uncaughtException` handlers (lines 26-33) close the client and exit non-zero. If a more controlled path is wanted, wrap in try/catch that `console.error`s and rethrows — but default propagation is sufficient given the existing handlers.

  ```ts
  async setup() {
    await db.$client.waitReady;
    await runMigrations(db);
  },
  ```

  Add import: `import { runMigrations } from "./database/migrate";`.

### Verification

- [ ] `bun run fix && bun run check` passes.
- [ ] `rm -rf dbdata && bun dev query --help` exits 0 with no migration-related stdout/stderr lines.
- [ ] `bun db:query "SELECT count(*) FROM __drizzle_migrations"` returns 3 (proves migrations ran during the previous step).
- [ ] `rm -rf dbdata && bun dev load --glob 'testdata/**/*.md'` works end-to-end without a prior `db:migrate`.
- [ ] Re-running any subcommand on an up-to-date DB produces no migration output.
- [ ] **Manual error path**: temporarily corrupt `drizzle/meta/_journal.json` (e.g. invalid JSON), run `bun dev query --help`, confirm an error is printed to `stderr` and exit code is non-zero. Restore the file afterwards.

> Pause after this phase for manual confirmation.

---

## References

- `src/main.ts:16-22` — citty `setup()` / `cleanup()` hooks.
- `src/main.ts:26-37` — process-level error handlers.
- `src/database/client.ts:7-18` — DB singleton.
- `scripts/migrate.ts:1-21` — current standalone runner (to be refactored).
- `drizzle/meta/_journal.json` — Drizzle migration journal.
- Drizzle ORM PGlite migrator: `drizzle-orm/pglite/migrator`.
