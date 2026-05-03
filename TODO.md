# TODO

- [x] Synthetic bench data
- [ ] General cleanup
- [ ] Add user-facing loading state (e.g. model downloading, DB migrating, data indexing)
- [ ] Centralize caching to node_modules/.cache/notes-query-tool
- [ ] Distribute on NPM
- [ ] Improve indexing time
- [ ] Allow remote embedding models
- [ ] Fix short flags not working

# Maybes

- [ ] Revisit chunking strategy (overlap, sentence boundaries, etc.)
- [ ] Split into monorepo with core as a separate package
  - [ ] Ship "skill" version with the agent driving the vector and fulltext flags
  - [ ] Ship "batteries included" version with a local-running LLM model exploding the query internally