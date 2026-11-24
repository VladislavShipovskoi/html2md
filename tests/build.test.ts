import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'node:vm';
import { build } from 'esbuild';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pageImagePlugin } from '../scripts/page-image-plugin.ts';
import { IDBFactory } from 'fake-indexeddb';
import { mockStorage } from './storage-helper.ts';

const output = new URL('../dist/', import.meta.url);

test('build contains a valid manifest, locale keys, side-panel and icon resources', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.action.default_popup, undefined);
  assert.equal(manifest.side_panel.default_path, 'side-panel.html');
  assert.ok(manifest.permissions.includes('sidePanel'));

  for (const name of ['side-panel', 'options', 'offscreen']) {
    const html = await readFile(new URL(`${name}.html`, output), 'utf8');
    const { window } = new JSDOM(html);
    try {
      for (const element of window.document.querySelectorAll('link[href], script[src], img[src]')) {
        await access(new URL(element.getAttribute('href') ?? element.getAttribute('src'), output));
      }
    } finally {
      window.close();
    }
  }

  for (const path of [
    manifest.side_panel.default_path,
    manifest.background.service_worker,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
  ]) {
    await access(new URL(path, output));
  }

  for (const locale of ['en', 'ru']) {
    const messages = JSON.parse(
      await readFile(new URL(`_locales/${locale}/messages.json`, output), 'utf8')
    );

    for (const [key, value] of Object.entries(messages)) {
      const { message } = value as { message: string };
      assert.ok(!/\?{3,}|\uFFFD/.test(message), `Damaged translation: ${locale}/${key}`);
    }

    for (const match of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
      assert.ok(messages[match[1]]?.message);
    }
  }

  const files = await readdir(output);
  assert.ok(!files.some((file) => file.endsWith('.ts')), 'TypeScript source leaked into dist');

  assert.equal(manifest.options_ui.open_in_tab, true);
});

test('bundled side-panel starts automatically and reports restricted pages', async () => {
  const html = await readFile(new URL('side-panel.html', output), 'utf8');
  const script = await readFile(new URL('side-panel.js', output), 'utf8');
  const { window } = new JSDOM(html, { runScripts: 'outside-only' });
  Object.assign(window, {
    chrome: {
      i18n: { getMessage: (key) => (key === '@@ui_locale' ? 'en' : key) },
      runtime: {
        sendMessage: async () => ({ ok: true, value: [] }),
        onMessage: { addListener() {}, removeListener() {} },
      },
      windows: { getCurrent: async () => ({ id: 10 }) },
      tabs: {
        query: async () => [{ id: 1, url: 'chrome://extensions' }],
        onActivated: { addListener() {}, removeListener() {} },
        onUpdated: { addListener() {}, removeListener() {} },
      },
    },
  });
  try {
    window.eval(script);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      window.document.querySelector<HTMLInputElement>('#message').textContent,
      'restrictedPage'
    );
    assert.equal(
      window.document.querySelector<HTMLInputElement>('main').getAttribute('aria-busy'),
      'false'
    );
  } finally {
    window.close();
  }
});

test('bundled worker registers queue handlers and starts without DOM', async () => {
  const handlers = [];
  const event = { addListener: () => {} };
  const { storage, locks } = mockStorage();
  const runtime = {
    id: 'test',
    getURL: (path) => 'chrome-extension://test/' + path,
    onMessage: { addListener: (handler) => handlers.push(handler) },
    onInstalled: event,
    onStartup: event,
    getContexts: async () => [],
    ContextType: { OFFSCREEN_DOCUMENT: 'offscreen' },
    sendMessage: async () => {},
  };
  const host = {
    action: { onClicked: event },
    sidePanel: { setPanelBehavior: async () => {} },
    runtime,
    storage: { ...storage, onChanged: event },
    alarms: { create: async () => {}, onAlarm: event },
    downloads: { onChanged: event },
    offscreen: {},
    scripting: {},
  };
  runInNewContext(await readFile(new URL('worker.js', output), 'utf8'), {
    chrome: host,
    indexedDB: new IDBFactory(),
    crypto,
    fetch,
    setTimeout,
    console,
    navigator: {
      locks: {
        request: (name, options, action) =>
          locks.request(name, () => (action ? action({}) : options())),
      },
    },
  });
  const response = await new Promise((resolve) => {
    for (const handler of handlers) {
      if (
        handler(
          { channel: 'html2md-queue', type: 'list' },
          { id: 'test', url: runtime.getURL('side-panel.html') },
          resolve
        )
      ) {
        return;
      }
    }

    assert.fail('Missing queue handler');
  });
  assert.deepEqual(JSON.parse(JSON.stringify(response)), { ok: true, value: [] });
});

test('bundled image downloader survives Chrome-style serialization with no module closure', async () => {
  const root = fileURLToPath(new URL('../', import.meta.url));
  const compiled = await build({
    stdin: {
      contents: "export { fetchImagesInPage } from './extension/browser/image-function.ts';",
      resolveDir: root,
    },
    plugins: [pageImagePlugin(root, resolve(root, 'extension'))],
    bundle: true,
    write: false,
    format: 'iife',
    globalName: 'images',
  });
  const exports: any = {};
  runInNewContext(compiled.outputFiles[0].text + '; exports.injected = images.fetchImagesInPage;', {
    exports,
  });
  const injected = exports.injected;
  const url = 'https://example.com/image.svg';
  const context: Record<string, any> = {
    urls: [url],
    maxTotalBytes: 1024,
    AbortSignal,
    Uint8Array,
    fetch: async () =>
      new Response(new Uint8Array([1, 2]), { headers: { 'Content-Type': 'image/svg+xml' } }),
    document: { images: [] },
  };
  const execute = () => runInNewContext(`(${injected.toString()})(urls,maxTotalBytes)`, context);
  const result = await execute();
  assert.deepEqual(Array.from(result[0].bytes), [1, 2]);
  assert.equal(result[0].type, 'image/svg+xml');
  context.fetch = async () => {
    throw new TypeError('Failed to fetch');
  };
  context.document = {
    images: [{ src: url, complete: true, naturalWidth: 100, naturalHeight: 100 }],
    createElement: () => ({
      getContext: () => ({ drawImage: () => {} }),
      toBlob: (callback) => callback(new Blob([new Uint8Array([3])], { type: 'image/png' })),
    }),
  };
  const fallback = await execute();
  assert.equal(fallback[0].type, 'image/png');
  assert.deepEqual(Array.from(fallback[0].bytes), [3]);
});
