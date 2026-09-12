import test from 'node:test';
import assert from 'node:assert/strict';
import { readResponse, outputText, responseBody, runResponses } from '../src/lib/responses.mjs';

const message = (text) => ({ type: 'message', id: 'msg_1', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }] });
const completed = (output) => ({ id: 'resp_1', status: 'completed', output });
const terminal = (output) => ({ type: 'response.completed', response: completed(output) });
function sse(events, { split = 7, finalNewline = true, crlf = false } = {}) {
  let text = events.map((ev) => `event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`).join('');
  if (!finalNewline) text = text.trimEnd();
  if (crlf) text = text.replaceAll('\n', '\r\n');
  const bytes = new TextEncoder().encode(text);
  return new Response(new ReadableStream({ start(controller) {
    for (let i = 0; i < bytes.length; i += split) controller.enqueue(bytes.slice(i, i + split));
    controller.close();
  }}), { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req_test' } });
}
const json = (output) => new Response(JSON.stringify(completed(output)), { headers: { 'content-type': 'application/json' } });
const run = (request, extra = {}) => runResponses({ model: 'test-model', input: [{ role: 'user', content: 'Check facts' }], request, ...extra });
const call = (i = 1, args = { query: 'ozone facts', max_results: 5 }) => ({
  id: `fc_${i}`, call_id: `call_${i}`, type: 'function_call', name: 'web_search', arguments: JSON.stringify(args), status: 'completed'
});

test('reads non-streaming raw output[].content[].text (not SDK-only output_text)', async () => {
  assert.equal(await run(async () => json([message('Fact-check result')])), 'Fact-check result');
});

test('completed SSE answer without any deltas is returned, not discarded', async () => {
  assert.equal(await run(async () => sse([terminal([message('Final answer')])]), { stream: true }), 'Final answer');
});

test('SSE handles UTF-8 split across bytes, CRLF, and final event without a blank line', async () => {
  const deltas = [];
  const response = await readResponse(sse([
    { type: 'response.output_text.delta', delta: 'Сайн байна' },
    terminal([message('Сайн байна уу')])
  ], { split: 1, finalNewline: false, crlf: true }), { onDelta: (d) => deltas.push(d) });
  assert.equal(deltas.join(''), 'Сайн байна');
  assert.equal(outputText(response), 'Сайн байна уу');
});

test('terminal answer is canonical even if deltas contained only part of it', async () => {
  const deltas = [];
  const answer = await run(async () => sse([
    { type: 'response.output_text.delta', delta: 'Partial' },
    terminal([message('Complete final answer')])
  ]), { stream: true, onDelta: (d) => deltas.push(d) });
  assert.equal(deltas.join(''), 'Partial');
  assert.equal(answer, 'Complete final answer');
});

test('fallback to output_item.done when a gateway omits terminal output', async () => {
  const response = await readResponse(sse([
    { type: 'response.output_item.done', output_index: 0, item: message('Retained answer') },
    { type: 'response.completed', response: { status: 'completed' } }
  ]));
  assert.equal(outputText(response), 'Retained answer');
});

test('incomplete response is an error with its reason, never empty success', async () => {
  await assert.rejects(readResponse(sse([{ type: 'response.incomplete', response: {
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: []
  }}])), (err) => /max_output_tokens/.test(err.message) && err.requestId === 'req_test');
});

test('failed SSE propagates the actual provider error', async () => {
  await assert.rejects(readResponse(sse([{ type: 'response.failed', response: {
    status: 'failed', error: { message: 'Provider failed this request' }, output: []
  }}])), /Provider failed this request/);
});

test('EOF without response.completed fails even if text deltas arrived', async () => {
  await assert.rejects(readResponse(sse([{ type: 'response.output_text.delta', delta: 'Partial text' }])), /disconnected before response.completed/);
});

test('completed but genuinely empty answer is not considered success', async () => {
  await assert.rejects(run(async () => sse([terminal([])])), /without any answer text/);
});

test('malformed SSE JSON is surfaced instead of swallowed', async () => {
  const res = new Response('data: {broken}\n\n', { headers: { 'content-type': 'text/event-stream' } });
  await assert.rejects(readResponse(res), /malformed stream event/);
});

test('refusal text is displayed rather than left as a spinner', async () => {
  const item = { type: 'message', role: 'assistant', content: [{ type: 'refusal', refusal: 'I cannot help with that request.' }] };
  assert.equal(await run(async () => json([item])), 'I cannot help with that request.');
});

for (const stream of [false, true]) {
  test(`reasoning + search continuation preserves every output item (stream=${stream})`, async () => {
    const reasoning = { id: 'rs_1', type: 'reasoning', summary: [], encrypted_content: 'opaque-encrypted-reasoning' };
    const outputs = [reasoning, message('Checking sources.'), call()];
    const requests = [];
    const input = [{ role: 'system', content: 'Full transcript with later chapters' }, { role: 'user', content: 'WATCHHEAD 0:02. Check facts' }];
    const answer = await runResponses({
      model: 'gpt-5-test', input, stream, effort: 'high',
      tools: [{ type: 'function', name: 'web_search' }],
      request: async (body) => {
        requests.push(structuredClone(body));
        const output = requests.length === 1 ? outputs : [message('Grounded answer')];
        return stream ? sse([terminal(output)]) : json(output);
      },
      executeTool: async (query, limit) => {
        assert.equal(query, 'ozone facts');
        assert.equal(limit, 5);
        return 'Verified source snippets';
      }
    });
    assert.equal(answer, 'Grounded answer');
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[1].input.slice(0, input.length), input);
    assert.deepEqual(requests[1].input.slice(input.length, input.length + outputs.length), outputs);
    assert.deepEqual(requests[1].input.at(-1), { type: 'function_call_output', call_id: 'call_1', output: 'Verified source snippets' });
    assert.deepEqual(requests[1].reasoning, { effort: 'high' });
    assert.equal(requests[1].store, false);
    assert.deepEqual(requests[1].include, ['reasoning.encrypted_content']);
  });
}

test('tool budget reserves a final answer turn instead of silently returning empty', async () => {
  const bodies = [];
  let searches = 0;
  const result = await run(async (body) => {
    bodies.push(body);
    return json(body.tool_choice === 'none' ? [message('Final with existing evidence')] : [call(bodies.length)]);
  }, {
    maxToolRounds: 2, tools: [{ type: 'function', name: 'web_search' }],
    executeTool: async () => { searches++; return 'Evidence'; }
  });
  assert.equal(result, 'Final with existing evidence');
  assert.equal(searches, 2);
  assert.equal(bodies.length, 3);
  assert.equal(bodies.at(-1).tool_choice, 'none');
});

test('model ignoring no-more-tools is an explicit error, not a false success', async () => {
  await assert.rejects(run(async () => json([call()]), {
    maxToolRounds: 0, tools: [{ type: 'function', name: 'web_search' }]
  }), /after the search limit/);
});

test('invalid/unknown tools are never executed', async () => {
  let requests = 0, executions = 0;
  await run(async (body) => {
    if (++requests === 1) return json([{ ...call(), name: 'arbitrary_tool' }]);
    assert.match(body.input.at(-1).output, /unavailable/);
    return json([message('Cannot perform that tool')]);
  }, { executeTool: async () => { executions++; return 'no'; } });
  assert.equal(executions, 0);
});

test('cancel during search prevents another model request', async () => {
  const controller = new AbortController();
  let requests = 0;
  await assert.rejects(run(async () => { requests++; return json([call()]); }, {
    signal: controller.signal,
    executeTool: async () => { controller.abort(); throw new DOMException('Stopped', 'AbortError'); }
  }), { name: 'AbortError' });
  assert.equal(requests, 1);
});

test('explicit effort none remains none; no forced temperature', () => {
  const body = responseBody('gpt-5-any', [], { effort: 'none' });
  assert.deepEqual(body.reasoning, { effort: 'none' });
  assert.equal('temperature' in body, false);
});
