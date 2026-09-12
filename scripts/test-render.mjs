// Regression checks for the blank-panel startup and loading-transcript crashes.
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
globalThis.window = { addEventListener() {} };
globalThis.location = { href: 'https://www.youtube.com/watch?v=abcdefghijk' };
globalThis.document = { querySelector: () => null };
const { outputFiles } = await build({
  stdin: {
    contents: `import React from 'react';
      import { renderToString } from 'react-dom/server';
      import App from './src/app.jsx';
      import Transcript from './src/ui/Transcript.jsx';
      import Chat from './src/ui/Chat.jsx';
      export const startup = () => renderToString(<App layout={{setOpen(){}}} />);
      export const loading = () => renderToString(<Transcript cues={null} />);
      export const empty = () => renderToString(<Transcript cues={[]} />);
      export const emptyReply = () => renderToString(<Chat cues={[]} effort="high" cached={[
        {role:'user', content:'Check facts', t:0}, {role:'assistant', content:''}
      ]} />);
      export const waitingForCaptions = () => renderToString(<Chat cues={null} effort="high" />);`,
    resolveDir: process.cwd(), loader: 'jsx'
  },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external'
});
const module = { exports: {} };
new Function('require', 'module', 'exports', outputFiles[0].text)(require, module, module.exports);
assert.match(module.exports.startup(), /class="app"/);
assert.match(module.exports.loading(), /class="skel"/);
assert.match(module.exports.empty(), /No captions/);
const emptyReply = module.exports.emptyReply();
assert.match(emptyReply, /Retry question/);
assert.match(emptyReply, /This earlier request ended without an answer/);
assert.doesNotMatch(emptyReply, /class="spin"/);
assert.match(module.exports.waitingForCaptions(), /Loading the video transcript before sending/);
console.log('PASS: startup, transcript loading/empty, cached empty reply, caption-loading guard');
