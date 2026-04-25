# notes-query-tool

Load and index notes:
`bun dev load --glob "testdata/**/*.md"`

Query notes:
`bun dev query --vector/-vs <semantic query> --fulltext/-fts <keyword query>`

Both flags are required.

## Examples

```sh
# Full flags
bun dev query --vector "Who is my girlfriend and what does she like?" --fulltext "girlfriend interests hobbies"

# Short aliases
bun dev query -vs "What are my long-term career goals?" -fts "career goals plans"

# Mixed
bun dev query --vector "Summarize my thoughts on stoicism" -fts "stoicism notes"
```
