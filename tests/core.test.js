import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { analyzePage, createMarkdown, exportArchive, fetchImages } from '../core/index.js';
import { prepareNotionExport, exportNotionArticle, createNotionApi } from '../core/notion/index.js';

test('public core API extracts HTML and creates Markdown and ZIP in Node without global DOM', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  assert.equal(typeof globalThis.chrome, 'undefined');
  const text = 'An article about programming, algorithms, and useful examples. '.repeat(15);
  const { window } = new JSDOM(
    `<title>CLI article</title><article><h1>CLI article</h1><p>${text}</p><p>${text}</p><img src="/diagram.png"></article>`,
    { url: 'https://example.com/article' }
  );
  try {
    const article = analyzePage(window.document);
    assert.equal(article.articleFound, true);
    const markdown = createMarkdown(article, window.document, 'Source');
    assert.ok(markdown.includes(text.trim()));
    const events = [];
    const archive = await exportArchive({
      article,
      document: window.document,
      sourceLabel: 'Source',
      downloadImages: (urls) =>
        fetchImages(urls, {
          fetcher: async (url) => {
            assert.equal(url, 'https://example.com/diagram.png');
            return new Response(new Uint8Array([1, 2, 3]), {
              headers: { 'Content-Type': 'image/png' },
            });
          },
          progress: (event) => events.push(event),
        }),
    });
    assert.equal(archive.filename, 'CLI article.zip');
    assert.equal(archive.failedCount, 0);
    const files = unzipSync(archive.bytes);
    assert.ok(strFromU8(files['CLI article.md']).includes('images/image-1.png'));
    assert.deepEqual([...files['images/image-1.png']], [1, 2, 3]);
    assert.equal(events.at(-1).completed, 1);
  } finally {
    window.close();
  }
});

test('Notion public workflow accepts an API without browser or localization globals', async () => {
  const { window } = new JSDOM('');
  try {
    const state = prepareNotionExport(
      {
        title: 'CLI',
        content: '<p>Text</p>',
        url: 'https://example.com',
        baseUrl: 'https://example.com',
      },
      window.document,
      {
        sourceLabel: 'Source',
        createId: () => 'test',
        formatImageError: ({ reason }) => `Image error: ${reason}`,
      }
    );
    let saved;
    await exportNotionArticle({
      state,
      title: 'CLI',
      parentId: 'parent',
      api: {
        createPage: async () => ({ id: 'page' }),
        writeMarkdown: async (_id, text) => {
          saved = text;
        },
      },
      downloadImages: async () => [],
      formatImageError: ({ reason }) => reason,
    });
    assert.ok(saved.startsWith('# CLI'));
    assert.equal(state.writing, 'confirmed');
    assert.equal(
      typeof createNotionApi({ token: 'unused', fetcher: async () => {}, sleep: async () => {} })
        .uploadImage,
      'function'
    );
  } finally {
    window.close();
  }
});

test('every relative import in core stays inside core, including dynamic imports', async () => {
  const root = fileURLToPath(new URL('../core/', import.meta.url));
  const packages = new Set(['@mozilla/readability', 'turndown', 'turndown-plugin-gfm', 'fflate']);

  for (const file of await readdir(root, { recursive: true })) {
    if (!file.endsWith('.js')) {
      continue;
    }

    const absolute = resolve(root, file);
    const source = await readFile(absolute, 'utf8');

    for (const match of source.matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)) {
      const specifier = match[1];

      if (specifier.startsWith('.')) {
        const target = resolve(dirname(absolute), specifier);
        assert.ok(
          target.startsWith(root.endsWith(sep) ? root : root + sep),
          `${file} imports outside core: ${specifier}`
        );
        await readFile(target);
      } else {
        assert.ok(packages.has(specifier), `Unexpected core dependency: ${specifier}`);
      }
    }
  }
});

test('Notion transport and retry timing are supplied explicitly by the host', async () => {
  const waits = [];
  let calls = 0;
  const api = createNotionApi({
    token: 'test-token',
    sleep: async (ms) => waits.push(ms),
    fetcher: async () => {
      calls++;
      return calls === 1
        ? { ok: false, status: 429, headers: { get: () => '2' }, json: async () => ({}) }
        : { ok: true, json: async () => ({ id: 'created-page' }) };
    },
  });
  assert.equal(
    (await api.createPage('123456781234123412341234567890ab', 'CLI')).id,
    'created-page'
  );
  assert.deepEqual(waits, [2000]);
  assert.throws(() => createNotionApi({ token: 'unused' }), /fetcher and sleep/);
});
