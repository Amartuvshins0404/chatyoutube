// Exercise the bundled worker through its real Chrome-port entry point.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { build } from 'esbuild';
const { outputFiles } = await build({ entryPoints: ['src/background.js'], bundle: true, write: false, format: 'iife' });
const message = (text) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] });
const response = (event) => new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { 'content-type': 'text/event-stream' } });

async function worker(fetch, settings = {}, args = {}) {
  let connect, listener;
  const sent = [];
  vm.runInNewContext(outputFiles[0].text, {
    console, AbortController, AbortSignal, TextDecoder, URL, setTimeout, clearTimeout, setInterval, clearInterval, btoa,
    chrome: {
      storage: { local: { get: async () => ({ settings: { apiKey: 'fake-key', model: 'test', searchProvider: 'off', ...settings } }) } },
      permissions: { getAll: async () => ({ origins: ['https://search.example/*'] }) },
      runtime: { onMessage: { addListener() {} }, onConnect: { addListener(fn) { connect = fn; } } }
    }, fetch
  });
  connect({ name: 'cytai', onDisconnect: { addListener() {} }, onMessage: { addListener(fn) { listener = fn; } }, postMessage(m) { sent.push(m); } });
  await listener({ stream: true, messages: [{ role: 'user', content: 'Check facts' }], ...args });
  return sent;
}

test('regression: final-only response delivers text through the actual worker port', async () => {
  const sent = await worker(async (url) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return response({ type: 'response.completed', response: { status: 'completed', output: [message('Fact-check result')] } });
  });
  assert.equal(sent.at(-1).type, 'done');
  assert.equal(sent.at(-1).text, 'Fact-check result');
});

test('regression: incomplete response sends error through worker, not done', async () => {
  const sent = await worker(async () => response({ type: 'response.incomplete', response: {
    status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' }, output: []
  }}));
  assert.equal(sent.at(-1).type, 'error');
  assert.match(sent.at(-1).error, /max_output_tokens/);
  assert.equal(sent.some((m) => m.type === 'done'), false);
});

test('regression: JSON highlights extract real output message text', async () => {
  const sent = await worker(async () => new Response(JSON.stringify({ status: 'completed', output: [message('{"highlights":[]}')] }), {
    headers: { 'content-type': 'application/json' }
  }), {}, { stream: false, json: true });
  assert.equal(sent.at(-1).text, '{"highlights":[]}');
});

test('worker search integration keeps reasoning context and sends grounded final answer', async () => {
  let modelCalls = 0, searches = 0;
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque' };
  const sent = await worker(async (url, options) => {
    if (url.startsWith('https://search.example')) {
      searches++;
      assert.equal(options.headers.Authorization, 'Basic ' + btoa('user:pass'));
      return new Response(JSON.stringify({ results: [{ title: 'Ozone science', url: 'https://example.com/science', content: 'Evidence' }] }));
    }
    const body = JSON.parse(options.body);
    assert.equal(body.reasoning.effort, 'high');
    if (++modelCalls === 1) return response({ type: 'response.completed', response: { status: 'completed', output: [reasoning, {
      type: 'function_call', call_id: 'call_1', name: 'web_search', arguments: '{"query":"ozone facts","max_results":5}'
    }] } });
    assert.ok(body.input.some((i) => i.encrypted_content === 'opaque'));
    assert.match(body.input.at(-1).output, /Evidence/);
    return response({ type: 'response.completed', response: { status: 'completed', output: [message('Grounded fact-check')] } });
  }, { searchProvider: 'searxng', searxUrl: 'https://search.example', searxAuth: 'user:pass' }, { allowTools: true, effort: 'high' });
  assert.equal(modelCalls, 2);
  assert.equal(searches, 1);
  assert.equal(sent.at(-1).text, 'Grounded fact-check');
  assert.equal(sent.some((m) => m.type === 'error'), false);
});
