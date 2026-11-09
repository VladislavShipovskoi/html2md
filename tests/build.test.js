import assert from 'node:assert/strict';
import { readFile, readdir, access } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';

const output = new URL('../dist/', import.meta.url);

test('build contains a valid manifest, locale keys, popup and icon resources', async () => {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', output), 'utf8'));
  assert.equal(manifest.manifest_version, 3);

  for (const path of [
    manifest.action.default_popup,
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

  for (const name of ['markdown.js', 'image-archive.js', 'code-blocks.js']) {
    assert.ok(!files.includes(name), `Unbundled module in output: ${name}`);
  }

  for (const name of ['popup.js', 'page-analysis.js']) {
    const script = await readFile(new URL(name, output), 'utf8');
    assert.ok(!/^import\s/m.test(script), `Unresolved imports: ${name}`);
  }
});

test('bundled popup starts automatically and reports restricted pages', async () => {
  const html = await readFile(new URL('popup.html', output), 'utf8');
  const script = await readFile(new URL('popup.js', output), 'utf8');
  const { window } = new JSDOM(html, { runScripts: 'outside-only' });
  window.chrome = {
    i18n: { getMessage: (key) => (key === '@@ui_locale' ? 'en' : key) },
    tabs: { query: async () => [{ id: 1, url: 'chrome://extensions' }] },
  };
  try {
    window.eval(script);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(window.document.querySelector('#message').textContent, 'restrictedPage');
    assert.equal(window.document.querySelector('main').getAttribute('aria-busy'), 'false');
  } finally {
    window.close();
  }
});
