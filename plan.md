# Bun → Node.js LTS Migration Implementation Plan

## Overview

Migrate `notes-query-tool` from the Bun runtime/toolchain to Node.js (v24+) using
native TypeScript type stripping (no transpiler), `tsc --noEmit` for type
checking, **pnpm** for dependency management, and Node's built-in test runner
(`node:test` + `node:assert/strict`) for tests. Biome is retained for linting
and formatting. The migration replaces all Bun-specific APIs with Node
equivalents and converts the existing Jest-style test suite to `node:assert`.

## Current State

- **Runtime**: Bun (per `AGENTS.md`, `package.json` scripts use `bun ...`).
- **Package manager**: Bun (`bun.lock`, `package.json:33-35` uses
  `patchedDependencies` field at top level).
- **TypeScript**: `tsc --noEmit` already used for type-checking
  (`package.json:16`). `tsconfig.json` uses `"moduleResolution": "bundler"`,
  `"allowImportingTsExtensions": true`, `"jsx": "react-jsx"` (unused —
  no JSX in source), and `"verbatimModuleSyntax": true`.
- **Tests**: 4 test files using `bun:test` (`test`, `expect`, `describe`,
  `beforeAll`). ~150 `expect(...)` calls using these matchers only:
  `.toEqual`, `.toBe`, `.toBeNull`, `.toBeInstanceOf`, `.toHaveLength`,
  `.toContain`, `.toBeLessThanOrEqual`, `.toBeGreaterThan`,
  `.toBeGreaterThanOrEqual`, `.toBeDefined`, `.not.toThrow`. No mocks,
  snapshots, fake timers, `test.each`, `.skip`, or `.only`.
- **Bun-specific API call sites**: 7 total
  - `src/commands/load.ts:52` — `Bun.file(p).text()`
  - `src/commands/load.ts:53-54` — `new Bun.CryptoHasher("sha256")...`
  - `src/commands/query.ts:65-67` — `Bun.file("...").delete()`
  - `src/commands/query.ts:68` — `Bun.write(...)`, `Bun.YAML.stringify(...)`
  - `src/files/frontmatter.ts:20` — `Bun.YAML.parse(...)`
  - `scripts/query.ts:63-64` — `Bun.argv[2]`
- **Imports**: pervasive extensionless relative imports (e.g.
  `src/main.ts:2-5`). One existing `.ts`-extension import:
  `src/files/chunker.test.ts:2`.
- **Patched dep**: `drizzle-kit@0.31.10` patch
  (`patches/drizzle-kit@0.31.10.patch`) injects `vector` + `unaccent` PGlite
  extensions into drizzle-kit's internal PGlite. Reusable verbatim by pnpm.
- **Deps Node-compat**: All 7 prod/dev deps work on Node 22+. `marked@18` and
  `p-limit@7` declare `engines.node >= 20`. `@huggingface/transformers` has a
  dedicated `node` export branch (`onnxruntime-node`) and runs *better* on
  Node than on Bun. No Bun-only entry points anywhere.
- **Local toolchain available**: Node v24.14.0, pnpm 10.32.1.

## Desired End State

- `pnpm install` is the only install command.
- `pnpm run check` (= `biome check . && tsc --noEmit && node --test ...`) is
  green on a clean clone.
- `pnpm run dev load --glob 'testdata/**/*.md'` and the `query`/`db:*`
  scripts work identically to today.
- No reference to Bun anywhere in source, scripts, configs, or `AGENTS.md`
  (except the archived `docs/bun-compile-approach.md`).
- All tests run under `node --test --test-reporter=spec` with
  `node:test` + `node:assert/strict`. Zero test deps.
- TypeScript runs natively via Node 24's default type-stripping (no `tsx`,
  no `ts-node`, no build step).
- `engines.node: ">=24"` declared in `package.json`.

### Verification (full)

- [ ] `pnpm install` succeeds on a clean checkout (no `node_modules`,
      no `bun.lock`).
- [ ] `pnpm run check` exits 0 (biome + tsc + tests).
- [ ] `pnpm run db:migrate` succeeds against a fresh `dbdata/`.
- [ ] `pnpm run testdata:load` ingests test fixtures successfully.
- [ ] `pnpm run dev query --vs "test" --fts "test"` produces results and
      writes `query_results.yaml`.
- [ ] `pnpm run db:query "SELECT count(*) FROM chunks"` returns a row.
- [ ] No matches for `\\bBun\\b|bun:test|Bun\\.` in `src/`, `scripts/`,
      `bench/`, `package.json`, `tsconfig.json`, `AGENTS.md`, `README.md`.

## Out of Scope

- Replacing PGlite, Drizzle, citty, marked, p-limit, or transformers.
- Replacing Biome.
- Producing a single-file executable (Node SEA / `pkg`). The
  `docs/bun-compile-approach.md` doc is left in place as an archived
  reference — see Phase 5.
- Adding CI configuration. (No CI exists today.)
- Bumping minor/patch versions of any production dep.
- Switching from PGlite to native Postgres.

## Workflow Constraints (operator-imposed)

- **Do NOT create branches.** Work on the current branch.
- **Do NOT create commits.** Stage changes after each phase using
  `git add -A` so the user can review with `git diff --staged` and commit
  manually. Do not run `git commit`.
- After each phase, **stop and wait** for explicit confirmation before
  proceeding to the next phase. The user wants manual smoke checks
  between phases.

---

## Phase 1: Imports & tsconfig — prepare for Node ESM resolution ✅

### Overview

Add explicit `.ts` extensions to every relative import and update
`tsconfig.json` to align with Node's `nodenext` resolution. After this phase
the project still runs on Bun (Bun accepts `.ts` extensions natively), but
becomes ready for Node's strip-types runtime which does **not** rewrite
import paths.

### Changes

- **All `.ts` files in `src/`, `scripts/`, `bench/`**: add `.ts` extension
  to every **relative** import path (`./foo` → `./foo.ts`,
  `../bar/baz` → `../bar/baz.ts`). Do **not** modify bare-package imports
  (`citty`, `drizzle-orm`, etc.) or already-extensioned paths
  (`./chunker.ts` in `src/files/chunker.test.ts:2`).

  Files known to need updates (non-exhaustive — discover all with grep):
  - `src/main.ts` (4 imports)
  - `src/commands/load.ts` (5 relative imports)
  - `src/commands/query.ts` (2 relative imports)
  - `src/commands/load/process-file.ts`
  - `src/commands/load/load-repository.ts`
  - `src/commands/load/decide-file-processing.ts`
  - `src/commands/load/decide-file-processing.test.ts`
  - `src/commands/load/process-file.test.ts`
  - `src/files/load-files.ts`
  - `src/files/frontmatter.ts` (none if no relative imports)
  - `src/database/client.ts`
  - `src/database/migrate.ts`
  - `src/database/schema/chunks.ts`
  - `src/database/schema/files.ts`
  - `src/query/execute.ts`
  - `src/embedder.ts`
  - `scripts/migrate.ts`
  - `scripts/query.ts`
  - `bench/retrieval.test.ts`
  - `bench/fixtures.ts`

  **Discovery command** (run before editing — produces a complete list):

  ```bash
  rg -n --no-heading -t ts "from ['\\\"]\\.\\.?/" src scripts bench
  ```

  For each match, ensure the import target ends in `.ts`. Skip imports
  that target a directory's barrel (e.g. `./schema`) only if such a
  barrel actually resolves — Node's strip-types does not do directory
  resolution; if a directory is imported, change to the explicit
  `./schema/index.ts` (verify the file exists first).

- **`tsconfig.json`**: replace as follows:

  ```jsonc
  {
    "compilerOptions": {
      "lib": ["ESNext"],
      "target": "ESNext",
      "module": "nodenext",
      "moduleResolution": "nodenext",
      "moduleDetection": "force",
      "allowJs": true,

      "allowImportingTsExtensions": true,
      "rewriteRelativeImportExtensions": false,
      "verbatimModuleSyntax": true,
      "noEmit": true,

      "strict": true,
      "skipLibCheck": true,
      "noFallthroughCasesInSwitch": true,
      "noUncheckedIndexedAccess": true,
      "noImplicitOverride": true,

      "noUnusedLocals": false,
      "noUnusedParameters": false,
      "noPropertyAccessFromIndexSignature": false
    }
  }
  ```

  Differences from current:
  - `module`: `"Preserve"` → `"nodenext"`
  - `moduleResolution`: `"bundler"` → `"nodenext"`
  - **Remove** `"jsx": "react-jsx"` (dead config, no JSX in repo).
  - Keep `"allowImportingTsExtensions": true` so `tsc --noEmit` accepts the
    new `.ts` extensions.

### Verification

- [x] `rg -n "from ['\\\"]\\.\\.?/[^'\\\"]+['\\\"]" src scripts bench`
      shows **every** relative import ending in `.ts`.
- [x] `bun run check` (still on Bun) passes — confirms Biome is happy,
      `tsc --noEmit` accepts the new tsconfig + extensions, and the
      existing `bun:test` suite still runs.
- [ ] `bun run dev --help` runs without error.
- [ ] `git add -A` then **stop**. Wait for user confirmation.

> Pause after this phase for manual confirmation before proceeding.

---

## Phase 2: Replace Bun runtime APIs ✅

### Overview

Replace every `Bun.*` call site with a Node-equivalent. After this phase the
**source code** is runtime-agnostic (runs on Bun and Node), but
`package.json` scripts and tests still reference Bun. We add the `yaml`
dependency in this phase.

### Changes

- **Add dep**: `yaml@^2` (eemeli/yaml) — pinned exact (project uses
  `save-exact=true` in `.npmrc`). Install via Bun for now to keep
  `bun.lock` valid until Phase 4 cuts over to pnpm:

  ```bash
  bun add yaml
  ```

  Confirm the resolved version is pinned (no `^`/`~`) in `package.json`.

- **`src/files/frontmatter.ts`**: replace `Bun.YAML.parse` with `yaml`'s
  `parse`:

  ```ts
  import { parse as parseYaml } from "yaml";
  // ...
  const parsed = parseYaml(match[1] as string);
  ```

- **`src/commands/load.ts`** (line 52-54): replace `Bun.file().text()` and
  `Bun.CryptoHasher`:

  ```ts
  import { readFile } from "node:fs/promises";
  import { createHash } from "node:crypto";
  // ...
  readText: (p) => readFile(p, "utf8"),
  hashContent: (content) =>
      createHash("sha256").update(content).digest("hex"),
  ```

  Note: `Bun.file(p).text()` accepts string paths; `readFile(p, "utf8")` is
  the direct equivalent.

- **`src/commands/query.ts`** (lines 65-68): replace `Bun.file().delete()`,
  `Bun.write`, `Bun.YAML.stringify`:

  ```ts
  import { writeFile, unlink } from "node:fs/promises";
  import { stringify as stringifyYaml } from "yaml";
  // ...
  await unlink("query_results.yaml").catch(() => {});
  await writeFile("query_results.yaml", stringifyYaml(results));
  ```

  Note: `yaml`'s `stringify(value, replacer?, options?)` mirrors
  `JSON.stringify` shape; the previous `Bun.YAML.stringify(results, null, 2)`
  passed `(replacer=null, indent=2)`. The `yaml` lib defaults to 2-space
  indent already, so plain `stringifyYaml(results)` is correct. If output
  diff matters, pass `{ indent: 2 }` explicitly as the second arg.

- **`scripts/query.ts:63-64`**: replace `Bun.argv` with `process.argv`:

  ```ts
  // Bun.argv[0]=runtime, [1]=script, [2]=user arg.
  // process.argv[0]=node, [1]=script, [2]=user arg. Same indexing.
  if (process.argv[2]) {
      sql = process.argv[2];
  }
  ```

- **Sanity sweep**: after edits, confirm no `Bun.` or `bun:` tokens remain
  in `src/` or `scripts/`:

  ```bash
  rg -n "Bun\\.|from ['\\\"]bun:" src scripts bench
  ```

  Expected matches: only `bun:test` imports in test files (handled in Phase 3).

### Verification

- [x] `bun run check` passes (Biome + tsc + bun:test).
- [ ] `bun run dev load --glob 'testdata/**/*.md'` completes successfully
      against a populated `testdata/`.
- [ ] `bun run dev query --vs "anything" --fts "anything"` produces
      output and writes `query_results.yaml` with valid YAML
      (`bun run db:query` not needed for this).
- [ ] `bun run db:migrate` (against a clean `dbdata/` if needed) succeeds.
- [ ] `git add -A` then **stop**.

> Pause after this phase for manual confirmation before proceeding.

---

## Phase 3: Migrate tests to `node:test` + `node:assert/strict` ✅

### Overview

Rewrite the four test files from `bun:test` (Jest-style `expect`) to Node's
built-in `node:test` and `node:assert/strict`. After this phase the test
suite runs under Node, not Bun. We do **not** yet swap the package manager.

### Files to migrate

1. `src/commands/load/decide-file-processing.test.ts` (4 tests, `expect`,
   `test`)
2. `src/commands/load/process-file.test.ts` (5 tests, `expect`, `test`)
3. `src/files/chunker.test.ts` (~22 tests in one `describe`,
   `describe`/`expect`/`test`)
4. `bench/retrieval.test.ts` (`beforeAll`, `expect`, `test`,
   parameterized via `for (const fx of fixtures)`)

### Mechanical translation table

| `bun:test` form | `node:test`/`node:assert/strict` form |
|---|---|
| `import { test, expect, describe, beforeAll } from "bun:test"` | `import { test, describe, before } from "node:test";`<br>`import assert from "node:assert/strict";` |
| `beforeAll(fn)` (top-level) | `before(fn)` (top-level — `node:test` runs top-level `before` once before any test in the file) |
| `expect(x).toEqual(y)` | `assert.deepEqual(x, y)` (note: `node:assert/strict` makes `deepEqual` strict by default) |
| `expect(x).toBe(y)` | `assert.equal(x, y)` (strict via `/strict`) |
| `expect(x).toBeNull()` | `assert.equal(x, null)` |
| `expect(x).toBeInstanceOf(C)` | `assert.ok(x instanceof C, \`expected instanceof ${C.name}\`)` |
| `expect(arr).toHaveLength(n)` | `assert.equal(arr.length, n)` |
| `expect(s).toContain(sub)` | for strings: `assert.ok(s.includes(sub))`<br>for arrays: `assert.ok(s.includes(sub))` (Array#includes works) |
| `expect(n).toBeLessThanOrEqual(m)` | `assert.ok(n <= m, \`${n} <= ${m}\`)` |
| `expect(n).toBeGreaterThan(m)` | `assert.ok(n > m, \`${n} > ${m}\`)` |
| `expect(n).toBeGreaterThanOrEqual(m)` | `assert.ok(n >= m, \`${n} >= ${m}\`)` |
| `expect(x).toBeDefined()` | `assert.notEqual(x, undefined)` |
| `expect(() => fn()).not.toThrow()` | `assert.doesNotThrow(() => fn())` |

### Translation rules

- Keep the **same test names and grouping**. `describe(...)` from
  `node:test` is structurally compatible.
- Replace **the import line only** at the top of each file; do not move or
  re-order tests.
- Helpful messages on `assert.ok(...)` are encouraged where the matcher
  hides values (instanceof, comparisons) but not required.
- For the parameterized `for (const fx of fixtures)` pattern in
  `bench/retrieval.test.ts`, leave the loop intact — `node:test` accepts
  multiple `test(...)` calls at top level just like `bun:test`.
- Do **not** introduce any matcher library or dep.

### Package.json script changes (this phase only)

Add a `node:test` runner script alongside the existing one for parallel
verification. **Do not yet remove the `bun test` script.** The `check`
script flips to use the Node runner:

```json
{
  "scripts": {
    "test": "node --test --test-reporter=spec 'src/**/*.test.ts' 'bench/**/*.test.ts'",
    "check": "biome check . && tsc --noEmit && pnpm run test"
  }
}
```

Wait — Phase 4 introduces pnpm. For this phase, while still on Bun:

```json
{
  "scripts": {
    "test": "node --test --test-reporter=spec 'src/**/*.test.ts' 'bench/**/*.test.ts'",
    "check": "biome check . && tsc --noEmit && bun run test"
  }
}
```

`bun run test` will execute the `node --test ...` command via the npm-style
script runner — that's fine, Bun just shells out. This keeps `bun run check`
working for the operator while tests run on Node.

**Important**: Node 24's strip-types is on by default and accepts `.ts`
files directly. If the operator is on Node 22.x, the script must add
`--experimental-strip-types`. Since the target is Node 24, we omit the flag
and document `engines.node: ">=24"` in Phase 4.

### Verification

- [x] `node --test --test-reporter=spec 'src/**/*.test.ts'` runs and all
      tests pass (run from repo root, with `node_modules` still present
      from Bun install).
- [x] `node --test --test-reporter=spec 'bench/**/*.test.ts'` runs and
      passes (note: `bench/retrieval.test.ts` requires the test DB to be
      populated; run `bun run testdata:reindex` first if needed).
- [x] `bun run check` passes end-to-end (Biome + tsc + `node --test`).
- [x] `rg -n "bun:test|expect\\(" src bench` returns **zero matches**.
- [ ] `git add -A` then **stop**.

> Pause after this phase for manual confirmation before proceeding.

---

## Phase 4: Package manager cutover (Bun → pnpm) ✅

### Overview

Replace Bun as the package manager with pnpm. Migrate the patched-dependency
config to pnpm's format, swap every `package.json` script to use `node` /
`pnpm`, remove `@types/bun`, add `@types/node`, and declare
`engines.node: ">=24"`. This is the cutover phase — after it, Bun is no
longer used anywhere.

### Changes

#### 1. Wipe Bun-managed install state

```bash
rm -rf node_modules bun.lock
```

#### 2. `package.json` — full rewrite

Update to:

```jsonc
{
  "name": "notes-query-tool",
  "type": "module",
  "private": true,
  "engines": {
    "node": ">=24"
  },
  "packageManager": "pnpm@10.32.1",
  "scripts": {
    "db:delete-stale-lock": "rm ./dbdata/postmaster.pid",
    "db:generate": "drizzle-kit generate",
    "db:migrate": "node scripts/migrate.ts",
    "db:query": "node scripts/query.ts",
    "db:push": "drizzle-kit push",
    "db:studio": "drizzle-kit studio",
    "testdata:load": "pnpm run dev load --glob 'testdata/**/*.md'",
    "testdata:reindex": "rm -rf dbdata && pnpm run db:migrate && pnpm run testdata:load",
    "dev": "node src/main.ts",
    "test": "node --test --test-reporter=spec 'src/**/*.test.ts' 'bench/**/*.test.ts'",
    "check": "biome check . && tsc --noEmit && pnpm run test",
    "fix": "biome check --write ."
  },
  "dependencies": {
    "@electric-sql/pglite": "0.4.4",
    "@huggingface/transformers": "4.1.0",
    "citty": "0.2.2",
    "drizzle-orm": "0.45.2",
    "marked": "18.0.1",
    "p-limit": "7.3.0",
    "yaml": "<resolved version from Phase 2>"
  },
  "devDependencies": {
    "@biomejs/biome": "2.4.12",
    "@types/node": "<latest 24.x types>",
    "drizzle-kit": "0.31.10",
    "typescript": "6.0.2"
  },
  "pnpm": {
    "patchedDependencies": {
      "drizzle-kit@0.31.10": "patches/drizzle-kit@0.31.10.patch"
    }
  }
}
```

Specifics:
- **Remove**: top-level `"module"` field (was `"src/main.ts"` — irrelevant
  for an app), top-level `"patchedDependencies"`, `@types/bun`.
- **Add**: `engines.node: ">=24"`, `packageManager`, `pnpm.patchedDependencies`,
  `@types/node`, `yaml` (already added in Phase 2; carry the resolved
  exact version forward).
- **Scripts**: every `bun ...` becomes `node ...` or `pnpm run ...`.
  `testdata:reindex` chains via `pnpm run` for cross-script invocation.
- **Pinning**: keep all dep versions exact (the `.npmrc` `save-exact=true`
  setting works for pnpm too).

#### 3. `.npmrc` — verify pnpm compatibility

```
save-exact=true
```

This is read by pnpm. No changes needed. Optionally add
`prefer-frozen-lockfile=true` if the operator wants stricter installs;
omit by default.

#### 4. Install

```bash
pnpm install
```

This must:
- Generate `pnpm-lock.yaml`.
- Apply the patch to `drizzle-kit@0.31.10` (verify by checking
  `node_modules/drizzle-kit/bin.cjs` contains `vector` / `unaccent` lines
  near the previously patched location).
- Pull onnxruntime-node + sharp prebuilds for `@huggingface/transformers`.

If pnpm complains the patch doesn't apply, regenerate it:

```bash
pnpm patch drizzle-kit@0.31.10
# edit the temp dir to match patches/drizzle-kit@0.31.10.patch
pnpm patch-commit <printed-temp-dir>
```

But the existing `.patch` file is unified-diff format and should apply
cleanly without regeneration.

#### 5. `.gitignore` — add pnpm artifacts if missing

Ensure `.gitignore` covers:

```
node_modules
.pnpm-store
```

Read the current file and append only what's missing.

### Verification

- [x] `pnpm install` succeeds, produces `pnpm-lock.yaml`, applies the
      drizzle-kit patch (no warnings about unapplied patches).
- [x] `node_modules/drizzle-kit/bin.cjs` contains the patched lines
      (grep for `@electric-sql/pglite/vector`).
- [x] `pnpm run check` passes (Biome + tsc + tests).
- [ ] `pnpm run db:migrate` against a clean `rm -rf dbdata && pnpm run db:migrate`.
- [ ] `pnpm run testdata:load` succeeds.
- [ ] `pnpm run dev query --vs "test" --fts "test"` produces output.
- [ ] `pnpm run db:query "SELECT count(*) FROM chunks"` returns a row.
- [ ] `rg -n "\\bbun\\b|Bun\\.|bun:test" package.json tsconfig.json src scripts bench`
      returns **zero matches** (excluding incidental matches in
      `bun.lock` which should be deleted).
- [ ] `git add -A` then **stop**.

> Pause after this phase for manual confirmation before proceeding.

---

## Phase 5: Documentation cleanup ✅

### Overview

Update `AGENTS.md` and `README.md` to reflect the Node + pnpm + `node:test`
stack. Mark the historical Bun-compile doc as archived. Final smoke check.

### Changes

- **`AGENTS.md`**: rewrite to replace all Bun guidance with Node/pnpm
  equivalents. Specifically:
  - Remove the "Always default to using Bun" preamble; replace with a
    "This project uses Node.js (>=24) with native TypeScript type
    stripping, pnpm for deps, and the built-in `node:test` runner" intro.
  - Replace the bullet list of Bun command swaps with the inverse table
    (e.g. "Use `node <file>` instead of `bun <file>`"; "Use `pnpm install`
    instead of `bun install`"; "Use `pnpm exec <cmd>` instead of
    `bunx <cmd>`").
  - Update the "Testing" section: `import { test } from "node:test"` and
    `import assert from "node:assert/strict"`. Show a small example.
  - Update the "APIs" section: drop `Bun.serve`/`Bun.$`/`Bun.file`
    advice. Recommend `node:fs/promises`, `node:crypto`, `yaml`, and the
    standard `WebSocket` global (Node 22+).
  - Update the "Database" section's `db:query` example to use `pnpm`.
  - Note that `.env` is **not** auto-loaded; if needed, run
    `node --env-file=.env <script>` (Node 20.6+).
  - Update "Changes verification" to `pnpm run fix && pnpm run check`.

- **`README.md`**: replace any `bun ...` install/run instructions with
  `pnpm ...` equivalents. Add a prerequisites line: "Node.js >= 24, pnpm
  >= 10".

- **`docs/bun-compile-approach.md`**: prepend an admonition block:

  ```markdown
  > **Status: ARCHIVED.** This document describes a research effort to
  > ship the project as a single-file Bun executable via
  > `bun build --compile`. The project has since migrated to Node.js and
  > the approach below is no longer applicable. Retained for historical
  > reference only.
  ```

  Do not delete the file.

- **`tsconfig.json`**: confirm the `"jsx": "react-jsx"` line was removed in
  Phase 1; if still present, remove it now.

- **Optional cleanup**: if `improvements-plan.md` references Bun, leave
  it alone unless a quick scan shows a misleading instruction; it's a
  scratch doc.

### Verification

- [x] `rg -n "\\bbun\\b" AGENTS.md README.md` returns no matches
      (excluding inside the explicit "instead of `bun ...`" examples and
      the archived doc).
- [x] `pnpm run check` still passes.
- [ ] Smoke run of full pipeline:
      `rm -rf dbdata && pnpm run db:migrate && pnpm run testdata:load && pnpm run dev query --vs "note" --fts "note"`
      produces results.
- [ ] `git add -A`, then notify the user the migration is complete and
      ready for review/commit.

---

## References

### Files touched (summary by phase)

- **Phase 1**: every `.ts` file in `src/`, `scripts/`, `bench/`;
  `tsconfig.json`.
- **Phase 2**: `src/files/frontmatter.ts`, `src/commands/load.ts`,
  `src/commands/query.ts`, `scripts/query.ts`, `package.json` (add `yaml`).
- **Phase 3**: `src/commands/load/decide-file-processing.test.ts`,
  `src/commands/load/process-file.test.ts`, `src/files/chunker.test.ts`,
  `bench/retrieval.test.ts`, `package.json` (script swap).
- **Phase 4**: `package.json`, `.gitignore`, deletion of `bun.lock` and
  `node_modules/`, addition of `pnpm-lock.yaml`.
- **Phase 5**: `AGENTS.md`, `README.md`, `docs/bun-compile-approach.md`,
  optional `tsconfig.json` cleanup.

### Key external references

- Node.js native TypeScript support:
  https://nodejs.org/api/typescript.html (strip-types, no path rewriting)
- Node.js test runner: https://nodejs.org/api/test.html
- Node.js assert/strict: https://nodejs.org/api/assert.html#strict-assertion-mode
- pnpm `patchedDependencies`:
  https://pnpm.io/package_json#pnpmpatcheddependencies
- `yaml` package: https://eemeli.org/yaml/

### Bun-specific call sites being replaced (file:line)

- `src/commands/load.ts:52` — `Bun.file(p).text()`
- `src/commands/load.ts:53-54` — `new Bun.CryptoHasher("sha256")...`
- `src/commands/query.ts:65-67` — `Bun.file("...").delete()`
- `src/commands/query.ts:68` — `Bun.write(...)` + `Bun.YAML.stringify(...)`
- `src/files/frontmatter.ts:20` — `Bun.YAML.parse(...)`
- `scripts/query.ts:63-64` — `Bun.argv[2]`

### Test files being rewritten (file:line of `bun:test` import)

- `src/commands/load/decide-file-processing.test.ts:1`
- `src/commands/load/process-file.test.ts:1`
- `src/files/chunker.test.ts:1`
- `bench/retrieval.test.ts:1`

### Notes for implementer

- **Node 22 vs 24**: This plan targets Node 24 (default-on type stripping,
  no flag). If a future contributor must run on Node 22, scripts will need
  `--experimental-strip-types` added. The `engines.node: ">=24"` declaration
  documents the requirement.
- **`yaml` indent**: `Bun.YAML.stringify(x, null, 2)` and
  `stringify(x)` from the `yaml` package both produce 2-space indent by
  default; output should match closely. If the existing
  `query_results.yaml` is treated as a stable format by other tools,
  diff the output before and after Phase 2 and pass `{ indent: 2 }`
  explicitly if needed.
- **`Array.fromAsync`**: used at `src/commands/load.ts:44`. Available in
  Node 22+ (stable). No changes needed.
- **`performance.now()`**: used at `src/commands/load.ts:22,76`. Global in
  Node 16+. No changes needed.
- **PGlite extensions**: `unaccent`, `vector`, `pg_trgm` are imported by
  user code (`src/database/client.ts`, `scripts/migrate.ts`,
  `scripts/query.ts`) and work identically on Node — no migration concern.
- **drizzle-kit patch**: must apply cleanly under pnpm. If it doesn't,
  the `init_connections` block in `node_modules/drizzle-kit/bin.cjs` may
  have shifted across reinstalls. Re-extract via `pnpm patch` and reapply
  the same logical change (inject `vector` + `unaccent` extensions and
  `CREATE EXTENSION IF NOT EXISTS` calls).

### Workflow reminders for the implementing agent

- Do not skip ahead. Each phase has independent verification; the user
  smoke-tests between phases.
- If a phase's verification fails, fix in place and re-run; do not
  proceed to the next phase until green.
