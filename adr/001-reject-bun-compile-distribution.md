# ADR 001: Reject Bun Single-File Executable Distribution

## Status

Rejected (archived)

## Context

We investigated compiling the app into a single-file native executable via `bun build --compile` for easy distribution, with the goal of full feature parity when placed in any directory.

## Decision

We rejected the Bun compile approach due to unresolvable upstream blockers:

1. **PGlite WASM** — Bun never embeds `postgres.data`, causing an `ENOENT` crash at startup ([oven-sh/bun#15032](https://github.com/oven-sh/bun/issues/15032)). Any workaround requires patching PGlite internals and breaks on every version bump.
2. **onnxruntime-node native bindings** — Bun does not embed dynamically resolved `.node` addons, so the binary fails when moved away from `node_modules` ([oven-sh/bun#15374](https://github.com/oven-sh/bun/issues/15374)).
3. **Migration folder resolution** — `drizzle-orm/pglite/migrator` reads files from disk; a custom migration runner would be needed for a compiled binary.
4. **Binary size** — Bun runtime (~100 MB) + PGlite WASM (~3 MB) + model weights (~300 MB) yields a 400+ MB binary.

## Consequences

The project migrated to Node.js. Node.js Single Executable Applications (SEA) remain a candidate for future distribution work.
