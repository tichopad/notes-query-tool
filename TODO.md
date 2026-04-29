# TODO

- [ ] Synthetic bench data
- [ ] General cleanup
- [ ] Improve indexing time
- [ ] Allow remote embedding models
- [ ] Distribute on NPM
- [ ] Fix short flags not working

# Maybes

- [ ] Revisit chunking strategy (overlap, sentence boundaries, etc.)
- [ ] Split into monorepo with core as a separate package
  - [ ] Ship "skill" version with the agent driving the vector and fulltext flags
  - [ ] Ship "batteries included" version with a local-running LLM model exploding the query internally