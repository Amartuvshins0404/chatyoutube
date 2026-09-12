# Blank-answer / endless-spinner repair

## Confirmed defects (reproduced locally)

The old worker was exercised via a mocked Chrome port with valid Responses payloads:

| Input | Old result |
| --- | --- |
| `response.completed` containing final text, with no text deltas | `{type: "done"}` — answer discarded |
| `response.incomplete` with `max_output_tokens` reason | `{type: "done"}` — failure reported as success |
| Non-streaming JSON with `output[].content[].text` | `{type: "done", text: ""}` — wrong extraction field |

These reproduce the false-success/empty-answer behavior. The original screenshot does not include the network response, so we cannot attribute that specific request to exactly one branch or to a particular model effort setting.

Additional defects: reasoning output items were discarded during search continuation; exhausting four tool rounds returned success without requiring an answer; local port disconnect on Stop did not directly settle its promise.

## Changes

- `src/lib/responses.mjs`: eventsource-parser for SSE framing; require terminal completion; extract canonical message text/refusals; propagate incomplete/failed/truncated streams as errors.
- Stateless search continuation replays all output items, including encrypted reasoning, before function outputs. A bounded search loop reserves its last turn for an answer.
- Worker progress/heartbeat and a three-minute overall deadline; search cancellation follows Stop.
- Bridge explicitly settles Stop, rejects empty successes, and forwards request IDs when available.
- Chat shows actual request phase, retains partial text on errors, and retries failed questions without duplicating them or moving their original timestamp. Failed/empty bubbles are not sent as assistant context.
- Effort `none` is sent explicitly. Effort settings are no longer silently discarded on errors. No default temperature is forced.

## Verification

`npm test`: 28 protocol/worker/bridge tests plus render checks. Includes final-only SSE, interrupted streams, non-streaming results, tool continuation with reasoning, tool budget exhaustion, cancellation and cached empty replies.

All tests use mocked provider responses. No paid OpenAI calls or user's credentials were used in these tests. A real Chrome + OpenAI request is still needed to verify this exact user's model/session.

Load extension version **1.1.1**, refresh YouTube, and use **Retry question** on the earlier blank reply. If the provider rejects it, the error and its request ID (when supplied) are now shown instead of an endless spinner.
