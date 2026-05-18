# TODO

- [x] Synthetic bench data
- [x] Add logging (+ `--verbose` flag)
- [x] Fix short flags not working
- [ ] General cleanup
- [ ] Automatically handle stale lock files (e.g. from crashes) to avoid manual `rm -rf dbdata/` when that happens
- [ ] Scoped vs. global store (or collections? maybe just go with collections and always default to a single "global" one)
- [ ] Add user-facing loading state (e.g. model downloading, DB migrating, data indexing)
- [ ] Centralize caching to node_modules/.cache/notes-query-tool
- [ ] Distribute on NPM
- [ ] Improve indexing time
- [ ] Allow remote embedding models
- [ ] Ship agent skill
- [ ] User config file
  - [ ] Include relevant constants when hashing for cache keys (e.g. chunk size, embedding model) so that changing those invalidates the cache

# Maybes

- [ ] Query cache
- [ ] Revisit chunking strategy (overlap, sentence boundaries, etc.)
- [ ] Allow more vector/fts/trigram queries to be passed in at once
- [ ] Split into monorepo with core as a separate package
  - [ ] Ship "batteries included" version with a local-running LLM model exploding the query internally