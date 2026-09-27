# AI assistant

```
Web drawer / Telegram ─► assistant.service.chat()
   1. Deterministic parser: slash commands, "add 30m testing to ER-431", "remind me at 5:30pm",
      and requests to modify Zoho (answered with the fixed read-only message). No AI needed.
   2. Otherwise, if an AI provider is available and the cost guard allows it:
      provider.generateWithTools(system prompt + recent history, allow-listed tool specs)
        └─► every tool call ─► ToolGateway.execute(name, args, { userId from session, policy })
   3. If no provider, or on error or limit: a deterministic fallback with the help text.
```

## Tool Gateway (`assistant/tool-gateway.ts`)
- **Allow-list:** only the tools in `packages/ai-contracts` exist: 18 READ_ONLY, 11 LOCAL_WRITE, 4 DANGEROUS_WRITE. Unknown names are rejected and logged.
- **Validation:** strict Zod schemas. Unknown keys (e.g. `userId`, `sql`) are rejected, and identity comes only from the session.
- **Permissions:** READ_ONLY runs immediately. LOCAL_WRITE waits for confirmation under the default policy `ALWAYS_CONFIRM_WRITES`. DANGEROUS_WRITE (delete entry, delete journal, mark leave, submit timesheet) always waits.
- **Confirmation state machine** in `assistant_action_logs`: PROPOSED → AWAITING_CONFIRMATION → CONFIRMED → EXECUTED/FAILED, or CANCELLED. Transitions are atomic compare-and-set, so a double click or a replay executes once. Confirmations expire after 10 minutes and only the owner can confirm. Stored arguments are re-validated before execution.
- **Handlers** (`assistant/handlers.ts`) call ordinary services. No SQL, no external writes, no code execution. Handler errors return only safe business messages (4xx), never internals.

## Providers (`modules/ai`)
`AIProvider` defines `generate`, `generateWithTools`, `stream` (non-incremental), and `validateToolCall`. Implementations: `GeminiProvider` (function calling, with a schema sanitiser) and `OpenAICompatibleProvider` (OpenRouter; Ollama via `/v1`). The provider comes from user settings plus keys in `.env`; LOCAL_ONLY mode allows only Ollama.

## Privacy and cost
- **Data modes:** LOCAL_ONLY (Ollama only), MINIMAL_REMOTE (default: drops emails, attendees, organizers, descriptions, locations, meeting links, and truncates text), FULL_CONTEXT (drops only secrets).
- **Prompt-injection defence:** the system prompt states that tool results are untrusted data. Tool results are wrapped as `{ untrusted_data: … }`. Even an instruction that fools the model can only *propose* writes, which you must confirm, and can never reach Zoho or GitHub.
- **Cost guard:** per-minute burst limit, an atomic daily request limit (`ai_usage_daily`), token accounting, input/output caps, max tool rounds and a bounded retry count.
- **Drafts** (weekly summary, next-week focus, retrospective, standup) always have a deterministic factual version; the AI only rewrites provided data, and the result stays editable.
