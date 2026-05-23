# Implementation Plan: Knowledge Bases (Multi-Tenancy)

This document outlines the phased, test-driven implementation plan for introducing "Bases" to the `notes-query-tool`.

## Phase 1: Database Schema Definitions ✅
**Goal:** Define the normalized `bases` table and link the `files` table to it using a composite unique constraint.
**Actions:**
1. [x] Create `src/database/schema/bases.ts` with an `id`, `name`, `createdAt`, and `updatedAt` column.
2. [x] Update `src/database/schema/files.ts`:
   - Add `baseId` as an integer foreign key referencing `bases.id`.
   - Remove the global `.unique()` constraint on `filePath`.
   - Add a composite unique constraint on `(baseId, filePath)`.
3. [x] Export the new `basesTable` in any index files if necessary.
**Verification:**
- [x] Run `pnpm run db:generate`. It should successfully generate a new SQL migration file reflecting the creation of the `bases` table and the modifications to the `files` table.
- [x] Run `pnpm run check` (Expect Type Errors: Typecheck will likely fail here because existing code inserting into `filesTable` is missing the `baseId`. We will fix this in subsequent phases).

## Phase 2: Database Operations for Bases (TDD) ✅
**Goal:** Implement the data access layer for retrieving and creating bases using the repository pattern (consistent with `DbLoadRepository`).
**Actions:**
1. **Red:** Create `src/database/base-repository.test.ts`. Write two tests:
   - [x] One verifying that `getBaseByName("nonexistent")` returns `undefined` or `null`.
   - [x] One verifying that `getOrCreateBase("my_base")` creates it on the first call, and returns the existing one on the second call.
   - [x] Run `pnpm run test` and watch these new tests fail.
2. **Green:** 
   - [x] Define a `BaseRepository` interface and `DbBaseRepository` implementation in a new file `src/database/base-repository.ts`.
   - [x] Implement the `getBaseByName` and `getOrCreateBase` functions inside `DbBaseRepository`.
**Verification:**
- [x] `pnpm run test` passes for the newly created tests.

## Phase 3: Global CLI Flag ✅
**Goal:** Expose the `--base` flag to all subcommands.
**Actions:**
1. [x] Edit `src/main.ts` to add the `base` argument to the root `defineCommand` args definition:
   ```typescript
   base: {
     type: "string",
     description: "Knowledge base name to use",
     default: "default",
   }
   ```
2. [x] Ensure that the `args` object parsed by `citty` propagates correctly to the `load` and `query` subcommand handlers.
**Verification:**
- Run `node src/main.ts --help`. The global `--base` flag should be visible in the output.

## Phase 4: Auto-Create and Scope `load` Command (TDD) ✅
**Goal:** Ensure loaded files are scoped to the correct base and missing bases are auto-created.
**Actions:**
1. **Red:** 
   - [x] Update existing tests in `src/commands/load/process-file.test.ts` (and anywhere else `filesTable` is mocked/used) to expect a `baseId`.
   - [x] Update the `LoadRepository` interface and its tests to accept `baseId` in methods like `getFileProcessingState` and `upsertFile`. 
   - These tests should currently fail or fail typechecking.
2. **Green:**
   - [x] In `src/commands/load.ts`, extract `args.base` and use `DbBaseRepository` to call `getOrCreateBase(args.base)`.
   - [x] Pass the returned `baseId` down into the `processFile` workflow.
   - [x] Update `DbLoadRepository` implementation to accept and use the `baseId` when querying and inserting into `filesTable`.
**Verification:**
- [x] `pnpm run check` should now pass cleanly as we have provided the required `baseId` types.
- [x] `pnpm run test` should pass.
- **Manual End-to-End:** Wipe the database (`rm -rf dbdata`), then run `pnpm run dev load --base testbase testdata/test-file.md`. Verify it succeeds without errors.

## Phase 5: Query Isolation and Validation (TDD) 🔄
**Goal:** Validate that queries run against a specific base and fail if the base does not exist.
**Actions:**
1. **Red:** 
   - [x] Write a test in `src/query/execute.test.ts` to assert that querying a non-existent base throws an error.
   - [x] Update existing query execution tests to include a `baseId` in their setup data. Verify tests fail because queries are currently crossing base boundaries or failing typechecks.
2. **Green:**
   - [x] In `src/commands/query.ts`, use `DbBaseRepository` to call `getBaseByName(args.base)`. If it returns null, throw a user-friendly error (e.g., `logger.error("Base '{name}' does not exist.")` and exit).
   - [x] Pass the resolved `baseId` down into the `executeSearch` / `scoring` functions.
   - [x] Update the SQL queries (FTS and Vector search) in `src/query/execute.ts` or `src/query/scoring.ts` to `INNER JOIN files ON chunks.file_id = files.id WHERE files.base_id = $baseId`.
**Verification:**
- [x] `pnpm run test` passes.
- **Manual End-to-End:** 
  - Run `pnpm run dev query "test" --base nonexistent`. Expect an explicit error.
  - Run `pnpm run dev query "test" --base testbase` (using the base created in Phase 4). Expect successful results scoped to that base.

## Conclusion
Once all 5 phases are complete and green, run the final `pnpm run fix && pnpm run check` to ensure the entire codebase is formatted, type-safe, and all tests pass.
