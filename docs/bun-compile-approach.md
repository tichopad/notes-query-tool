> **Status: ARCHIVED.** This document describes a research effort to
> ship the project as a single-file Bun executable via
> `bun build --compile`. The project has since migrated to Node.js and
> the approach below is no longer applicable. Retained for historical
> reference only.

# Bun Single-File Executable — Research & Rejection

## Goal

Investigate compiling the app into a single-file native executable via `bun build --compile` that works when placed in any directory (e.g. `/tmp`) with full feature parity.

## Findings

### What works

- App source (TypeScript, citty CLI) bundles cleanly.
- Drizzle SQL migrations can be embedded via `with { type: "file" }` import attributes.
- `cwd`-relative paths (`./dbdata/`, `query_results.yaml`) are a non-issue — they are intentional user-facing behavior.

### Blockers

1. **PGlite WASM (`postgres.data` missing)** — open bug [oven-sh/bun#15032](https://github.com/oven-sh/bun/issues/15032) since Nov 2024, unresolved. PGlite's emscripten runtime tries to load `postgres.data` from a path Bun rewrites to `/$bunfs/root/postgres.data` but never actually embeds the file. Result: `ENOENT` crash at startup. PGlite upstream labeled this outside their control ([electric-sql/pglite#414](https://github.com/electric-sql/pglite/issues/414)). Workaround requires patching PGlite's internal loader — breaks on every PGlite version bump.

2. **onnxruntime-node native bindings** — `@huggingface/transformers` relies on `onnxruntime-node`, which ships prebuilt `.node` addons and `.so`/`.dylib` libs resolved via `bindings`/dynamic lookup. Bun only embeds `.node` files referenced via direct `require()`, not dynamic resolution ([oven-sh/bun#15374](https://github.com/oven-sh/bun/issues/15374)). Binary fails when moved away from `node_modules`.

3. **Migration folder resolution** — `src/database/migrate.ts` resolves the `drizzle/` folder via `fileURLToPath(new URL("../../drizzle", import.meta.url))` and hands the path to `drizzle-orm/pglite/migrator`, which reads files from disk. Requires a custom migration runner to work in a compiled binary.

4. **Binary size** — Bun runtime alone is ~100 MB. Adding PGlite WASM (~3 MB) and model weights (~300 MB if embedded) yields a 400+ MB binary.

## Verdict

**Not feasible or maintainable.** Two open upstream Bun bugs with no fix timeline mean any working solution would rest on brittle patches that break on routine dependency updates. Even if patched, the result is a very large binary with a fragile build process.

## Next Step

Explore migrating to Node.js and using **Node.js Single Executable Applications (SEA)** as an alternative path to a distributable native binary.
