import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { runInNewContext } from 'node:vm';

const output = new URL('../dist/', import.meta.url);

test('build contains a valid manifest, locale keys, popup and icon resources', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'));
  assert.equal(manifest.manifest_version, 3);

  for (const name of ['popup', 'options']) {
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
    manifest.action.default_popup,
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

    for (const match of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) {
      assert.ok(messages[match[1]]?.message);
    }
  }

  const files = await readdir(output);
  assert.ok(!files.some((file) => file.endsWith('.ts')), 'TypeScript source leaked into dist');

  assert.equal(manifest.options_ui.open_in_tab, true);

  for (const name of [
    'markdown.js',
    'image-archive.js',
    'code-blocks.js',
    'notion-settings.js',
    'integrations.js',
    'notion-content.js',
    'notion-export.js',
    'export-state.js',
    'runtime.js',
  ]) {
    assert.ok(!files.includes(name), `Unbundled module in output: ${name}`);
  }

  for (const name of ['popup.js', 'page-analysis.js', 'options.js']) {
    const script = await readFile(new URL(name, output), 'utf8');
    assert.ok(!/^import\s/m.test(script), `Unresolved imports: ${name}`);
  }
});

test('bundled popup starts automatically and reports restricted pages', async () => {
  const html = await readFile(new URL('popup.html', output), 'utf8');
  const script = await readFile(new URL('popup.js', output), 'utf8');
  const { window } = new JSDOM(html, { runScripts: 'outside-only' });
  Object.assign(window, {
    chrome: {
      i18n: { getMessage: (key) => (key === '@@ui_locale' ? 'en' : key) },
      tabs: { query: async () => [{ id: 1, url: 'chrome://extensions' }] },
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

test('bundled image downloader survives Chrome-style serialization with no module closure', async () => {
  const html = await readFile(new URL('popup.html', output), 'utf8');
  const script = await readFile(new URL('popup.js', output), 'utf8');
  const { window } = new JSDOM(html, { runScripts: 'outside-only' });
  const url = 'https://example.com/image.svg';
  let injected;
  Object.assign(window, {
    chrome: {
      i18n: { getMessage: (key) => (key === '@@ui_locale' ? 'en' : key) },
      tabs: { query: async () => [{ id: 7, url: 'https://example.com/article' }] },
      scripting: {
        executeScript: async (request) => {
          if (request.files) {
            return [
              {
                result: {
                  supported: true,
                  articleFound: true,
                  title: 'Test',
                  characters: 4,
                  content: `<p>Text</p><img src="${url}">`,
                  url: 'https://example.com/article',
                  baseUrl: 'https://example.com/',
                },
              },
            ];
          }

          injected = request.func;
          return [{ result: [] }];
        },
      },
    },
  });
  try {
    window.eval(script);
    await new Promise((resolve) => setImmediate(resolve));
    window.document.querySelector<HTMLInputElement>('#convert').click();
    window.document.querySelector<HTMLInputElement>('#download').click();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(typeof injected, 'function');
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
  } finally {
    window.close();
  }
});
