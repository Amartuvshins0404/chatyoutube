import { createParser } from 'eventsource-parser';

export const RESPONSES_URL = 'https://api.openai.com/v1/responses';

export function responseBody(model, input, { stream = false, json, effort, max_tokens } = {}) {
  const body = {
    model, input, stream, store: false,
    // Retain encrypted reasoning when continuing function calls without server-side storage.
    include: ['reasoning.encrypted_content']
  };
  if (effort) body.reasoning = { effort }; // 'none' is explicit, not the model's default.
  if (json) body.text = { format: { type: 'json_object' } };
  if (max_tokens) body.max_output_tokens = max_tokens;
  // No forced sampling parameters: the model's defaults are the most portable.
  return body;
}

export function outputText(response) {
  const parts = (response.output || [])
    .filter((item) => item.type === 'message')
    .flatMap((item) => item.content || [])
    .map((part) => part.type === 'output_text' ? part.text : part.type === 'refusal' ? part.refusal : '')
    .filter(Boolean);
  return parts.join('\n') || response.output_text || '';
}

function assertCompleted(response) {
  if (response.status === 'incomplete') {
    throw new Error(`OpenAI stopped before finishing (${response.incomplete_details?.reason || 'unknown reason'}). No complete answer was returned.`);
  }
  if (response.error || response.status === 'failed') {
    throw new Error(response.error?.message || 'OpenAI reported a failed response.');
  }
  if (response.status !== 'completed') {
    throw new Error(`OpenAI did not complete the response (status: ${response.status || 'missing'}).`);
  }
  return response;
}

/** Understand the Responses lifecycle, not just text deltas. Reject EOF without a terminal event. */
export async function readResponse(res, { onDelta = () => {}, onStatus = () => {}, onTool = () => {} } = {}) {
  const requestId = res.headers.get('x-request-id');
  try {
    if ((res.headers.get('content-type') || '').includes('application/json')) {
      return assertCompleted(await res.json());
    }
    if (!res.body || !(res.headers.get('content-type') || '').includes('text/event-stream')) {
      throw new Error('OpenAI returned neither a Responses stream nor JSON.');
    }
    let completed = null;
    const items = new Map();
    const parser = createParser({
      maxBufferSize: 8 * 1024 * 1024,
      onEvent({ data }) {
        if (completed || data === '[DONE]') return;
        let event;
        try { event = JSON.parse(data); }
        catch { throw new Error('OpenAI sent a malformed stream event.'); }
        if (event.type === 'error') throw new Error(event.message || event.error?.message || 'OpenAI stream error.');
        if (event.type === 'response.failed' || event.type === 'response.incomplete') {
          assertCompleted({ ...event.response, status: event.type.split('.')[1] });
        }
        if (event.type === 'response.completed') {
          if (!event.response) throw new Error('OpenAI completion event has no response body.');
          completed = assertCompleted({ ...event.response, status: event.response.status || 'completed' });
          // Some compatible gateways omit output in the terminal event; retain done items.
          if (!completed.output?.length && items.size) completed.output = [...items.entries()].sort(([a], [b]) => a - b).map(([, item]) => item);
        } else if (event.type === 'response.output_text.delta') {
          onStatus('Writing answer');
          if (event.delta) onDelta(event.delta);
        } else if (event.type === 'response.output_item.added') {
          if (event.item?.type === 'reasoning') onStatus('Reasoning');
          if (event.item?.type === 'web_search_call') onStatus('Searching the web');
          if (event.item?.type === 'function_call') onStatus('Preparing search');
        } else if (event.type === 'response.output_item.done') {
          if (event.item) items.set(event.output_index ?? items.size, event.item);
          if (event.item?.type === 'web_search_call') {
            onTool({ name: 'web_search', query: event.item.action?.query || '', status: 'completed' });
          }
        }
      },
      onError(error) { if (error.type === 'max-buffer-size-exceeded') throw error; }
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (!completed) {
        const { done, value } = await reader.read();
        if (done) {
          // Flush the decoder AND the final event even when no trailing blank line arrived.
          parser.feed(decoder.decode() + '\n\n');
          break;
        }
        parser.feed(decoder.decode(value, { stream: true }));
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    if (!completed) throw new Error('OpenAI stream disconnected before response.completed. Please retry.');
    return completed;
  } catch (error) {
    if (requestId) error.requestId = requestId;
    throw error;
  }
}

/** Shared by streaming chat and non-streaming generators. No successful empty answers. */
export async function runResponses({
  model, input, stream = false, json, effort, max_tokens,
  tools = [], request, executeTool, signal,
  onDelta, onStatus = () => {}, onTool,
  maxToolRounds = 3, maxToolCalls = 8
}) {
  let history = [...input];
  let executed = 0;
  for (let round = 0; round <= maxToolRounds; round++) {
    signal?.throwIfAborted();
    const body = responseBody(model, history, { stream, json, effort, max_tokens });
    if (tools.length) body.tools = tools;
    // Reserve a final turn for an answer rather than silently exhausting the tool loop.
    if (round === maxToolRounds) {
      body.tool_choice = 'none';
      body.input = [...history, {
        role: 'developer',
        content: 'The search budget is reached. Give your final answer using the transcript and collected results. State any missing evidence or search failures honestly; do not request more searches.'
      }];
    }
    onStatus(round ? 'Preparing answer from search results' : 'Waiting for OpenAI');
    const res = await request(body, signal);
    const response = await readResponse(res, { onDelta, onStatus, onTool });
    signal?.throwIfAborted();
    const output = response.output || [];
    const calls = output.filter((item) => item.type === 'function_call');
    if (!calls.length) {
      const text = outputText(response);
      if (!text.trim()) {
        const error = new Error('OpenAI completed without any answer text. Retry the request; no answer was saved.');
        error.requestId = res.headers.get('x-request-id') || undefined;
        throw error;
      }
      return text;
    }
    if (round === maxToolRounds) throw new Error('The model kept requesting tools after the search limit. No final answer was returned.');

    // IMPORTANT: replay ALL returned items, including reasoning, ids, encrypted_content,
    // and intermediate messages, in their original order before the tool outputs.
    history = [...history, ...output];
    for (const call of calls) {
      signal?.throwIfAborted();
      if (!call.call_id) throw new Error('OpenAI returned a function call without a call_id.');
      let result;
      try {
        if (call.name !== 'web_search' || !executeTool) throw new Error(`Tool ${call.name} is unavailable.`);
        if (++executed > maxToolCalls) throw new Error('Search budget reached. Use the results already returned.');
        const args = JSON.parse(call.arguments);
        if (typeof args.query !== 'string' || !args.query.trim() || args.query.length > 500) throw new Error('Invalid search query.');
        const limit = Number.isFinite(args.max_results) ? Math.min(8, Math.max(1, Math.trunc(args.max_results))) : 5;
        onTool?.({ name: call.name, query: args.query, status: 'searching' });
        onStatus('Searching the web');
        result = await executeTool(args.query, limit, signal);
      } catch (error) {
        signal?.throwIfAborted();
        result = JSON.stringify({ error: error.message || 'Search failed', results: [] });
      }
      history.push({ type: 'function_call_output', call_id: call.call_id, output: result });
    }
  }
  throw new Error('Response loop ended without an answer.');
}
