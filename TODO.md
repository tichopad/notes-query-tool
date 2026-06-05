# TODO

- [x] Synthetic bench data
- [x] Add logging (+ `--verbose` flag)
- [x] Fix short flags not working
- [x] Scoped vs. global store (or collections? maybe just go with collections and always default to a single "global" one)
- [x] Use in-memory PGLite for tests (reproducible, faster, no cleanup needed)
- [x] execute.ts imports client.ts on load, spawning a second PGlite connection to ./dbdata/. when the tests are running
- [ ] General cleanup
- [ ] Automatically handle stale lock files (e.g. from crashes) to avoid manual `rm -rf dbdata/` when that happens (**this might actually be a bigger issue than I thought**)
- [ ] Add user-facing loading state (e.g. model downloading - especially this, but also DB migrating, data indexing)
- [ ] Centralize caching to node_modules/.cache/notes-query-tool
- [ ] Distribute on NPM
- [ ] Improve indexing time
- [ ] Allow remote embedding models
- [ ] Ship agent skill
- [ ] Do `pnpm audit` and fix any vulnerabilities
- [ ] Remove the warning log when load or query runs
- [ ] Add minimum vector threshold?
- [ ] Check and handle relative/absolute paths more robustly (is CWD always where it's expected to be?)
- [ ] User config file
  - [ ] Include relevant constants when hashing for cache keys (e.g. chunk size, embedding model) so that changing those invalidates the cache

# Maybes

- [ ] Query cache
- [ ] Revisit chunking strategy (overlap, sentence boundaries, etc.)
- [ ] Allow more vector/fts/trigram queries to be passed in at once
- [ ] Split into monorepo with core as a separate package
  - [ ] Ship "batteries included" version with a local-running LLM model exploding the query internally
