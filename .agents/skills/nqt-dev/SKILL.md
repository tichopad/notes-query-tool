---
name: nqt-dev
description: Use the local notes-query-tool CLI to find and read relevant notes in response to user queries
argument-hint: A natural language question or query
---

## Core constraint

You must **never** use filesystem exploration tools (glob, grep, directory listing, find, or any equivalent) to discover or read notes. The CLI is the **only** permitted mechanism for finding relevant notes. This simulates a large collection where direct exploration is not viable.

## Workflow

1. **Query** the indexed notes using the CLI.
2. **Re-query** with rephrased terms if the results are clearly irrelevant or insufficient.
3. **Read** the files returned if they appear relevant and the chunk content isn't sufficient, and use the content to answer the user's question.
3. If results are still insufficient after re-querying, **tell the user** the notes don't appear to cover the topic. Do not hallucinate.
4. **Cite** every file you read as sources at the end of your answer.

## CLI command

Run from the project root:

```sh
pnpm run dev query -v "<vector query>" -f "<fulltext query>"
```

The `--trigram` / `-g` flag is optional:

```sh
pnpm run dev query -v "<vector query>" -f "<fulltext query>" -g "<trigram query>"
```

## Query formulation guidance

| Flag | Syntax | Purpose | Guidance |
|------|--------|---------|----------|
| `--vector` / `-v` | Natural language sentence or question | Semantic / paraphrase matching via embeddings | Write a full natural language question or sentence that captures the meaning of what you're looking for. |
| `--fulltext` / `-f` | Keywords; supports websearch syntax (`OR`, `-word`, `"exact phrase"`) | Keyword matching via PostgreSQL full-text search | Use the key terms. Use `OR` for alternatives, `-word` to exclude a term, `"phrase"` for exact phrases. |
| `--trigram` / `-g` | Plain text, no operators | Lexical / proper-noun matching via trigram similarity | Use when `--fulltext` contains websearch operators, or when you're searching for proper nouns, names, or exact spellings that FTS tokenisation may miss. Omit when not needed. |

## Example

```sh
pnpm run dev query \
  -v "What are my long-term career goals and plans?" \
  -f "career goals OR plans" \
  -g "career goals"
```

## Citing sources

Always list the files you read at the end of your response, e.g.:

---
**Sources:**
- `notes/Career.md`
- `notes/Journal/2024-03-15.md`
