import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
const { outputFiles } = await build({ entryPoints: ['src/lib/api.js'], bundle: true, write: false, platform: 'node', format: 'cjs' });
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { complete } = module.exports;

function harness() {
  let onMessage, onDisconnect;
  const port = {
    disconnected: false,
    onMessage: { addListener(fn) { onMessage = fn; } },
    onDisconnect: { addListener(fn) { onDisconnect = fn; } },
    postMessage() {},
    disconnect() { this.disconnected = true; }, // Chrome does NOT notify the disconnecting end.
    emit(msg) { onMessage(msg); },
    loseConnection() { onDisconnect(); }
  };
  globalThis.chrome = { runtime: { connect: () => port } };
  return port;
}

test('Stop settles promise locally, preserving partial text (no disconnect callback needed)', { timeout: 1000 }, async () => {
  const port = harness();
  const request = complete({ messages: [] });
  port.emit({ type: 'delta', text: 'Partial answer' });
  request.abort();
  await assert.rejects(request.promise, (e) => e.name === 'AbortError' && e.partialText === 'Partial answer');
  assert.equal(port.disconnected, true);
});

test('bridge uses canonical final answer even when no deltas arrived', async () => {
  const port = harness();
  const request = complete({ messages: [] });
  port.emit({ type: 'done', text: 'Real final answer' });
  assert.equal(await request.promise, 'Real final answer');
});

test('bridge rejects empty success from older workers', async () => {
  const port = harness();
  const request = complete({ messages: [] });
  port.emit({ type: 'done' });
  await assert.rejects(request.promise, /without answer text/);
});

test('request failure preserves partial answer and diagnostic request id', async () => {
  const port = harness();
  const request = complete({ messages: [] });
  port.emit({ type: 'delta', text: 'Not finished' });
  port.emit({ type: 'error', error: 'Output limit reached', requestId: 'req_failure' });
  await assert.rejects(request.promise, (e) => e.partialText === 'Not finished' && e.requestId === 'req_failure');
});

test('disconnected worker rejects rather than leaving promise pending', async () => {
  const port = harness();
  const request = complete({ messages: [] });
  port.loseConnection();
  await assert.rejects(request.promise, /connection closed/);
});

test('progress reaches UI, but late events after stop cannot alter it', async () => {
  const port = harness();
  const phases = [], deltas = [];
  const request = complete({ messages: [], onStatus: (s) => phases.push(s), onDelta: (d) => deltas.push(d) });
  port.emit({ type: 'status', phase: 'Reasoning' });
  request.abort();
  await assert.rejects(request.promise, { name: 'AbortError' });
  port.emit({ type: 'delta', text: 'Late update' });
  port.emit({ type: 'status', phase: 'Done' });
  assert.deepEqual(phases, ['Reasoning']);
  assert.deepEqual(deltas, []);
});
