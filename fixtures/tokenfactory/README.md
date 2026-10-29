# Token Factory fixtures

Synthetic. No recorded provider output, no customer data. Used when `TF_MODE` is `fixture`, or
`replay` finds no recording. The UI badges anything built from these as "Sample data".

- `menu-board.json`: a chat completion as the vision model would answer for a cafe menu board.
- `chat-text.json`: a plain text completion.
- Embeddings, rerank scores, tool calls and schema-shaped JSON are generated in code
  (`src/server/tokenfactory/fixtures.ts`), deterministically from the request.
