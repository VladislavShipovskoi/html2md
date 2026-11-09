import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { imageUrls, fetchImages, createArchive } from '../extension/image-archive.js';

const article = {
  title: 'Example',
  url: 'https://example.com/story',
  baseUrl: 'https://example.com/assets/',
  content:
    '<p>Text</p><img src="diagram.svg" alt="Diagram"><img src="diagram.svg" alt="Duplicate"><img src="missing.png" alt="Missing">',
};

test('resolves and deduplicates image URLs', () => {
  const { window } = new JSDOM('');
  assert.deepEqual(imageUrls(article, window.document), [
    'https://example.com/assets/diagram.svg',
    'https://example.com/assets/missing.png',
  ]);
  window.close();
});

test('ZIP contains image bytes, local references and a missing image report', () => {
  const { window } = new JSDOM('');
  const archive = createArchive(
    article,
    [
      { url: 'https://example.com/assets/diagram.svg', type: 'image/svg+xml', bytes: [1, 2, 3] },
      { url: 'https://example.com/assets/missing.png', failed: true },
    ],
    window.document,
    'Source'
  );
  const files = unzipSync(archive.bytes);
  const markdown = strFromU8(files['Example.md']);
  assert.deepEqual([...files['images/image-1.svg']], [1, 2, 3]);
  assert.equal(markdown.match(/images\/image-1.svg/g).length, 2);
  assert.ok(markdown.includes('https://example.com/assets/missing.png'));
  assert.equal(strFromU8(files['missing-images.txt']), 'https://example.com/assets/missing.png\n');
  assert.equal(archive.failedCount, 1);
  window.close();
});

test('handles successful images, HTTP errors, HTML responses and network failures', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/ok')) {
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    }

    if (url.endsWith('/404')) {
      return new Response('', { status: 404 });
    }

    if (url.endsWith('/login')) {
      return new Response('<html>Login</html>', { headers: { 'content-type': 'text/html' } });
    }

    throw new Error('Network error');
  });
  const results = await fetchImages([
    'https://example.com/ok',
    'https://example.com/404',
    'https://example.com/login',
    'https://example.com/error',
  ]);
  assert.deepEqual(results[0].bytes, [1, 2, 3]);
  assert.ok(results.slice(1).every((result) => result.failed));
});

test('creates Markdown-only ZIP when there are no images', () => {
  const { window } = new JSDOM('');
  const result = createArchive(
    { ...article, content: '<p>Text</p>' },
    [],
    window.document,
    'Source'
  );
  assert.deepEqual(Object.keys(unzipSync(result.bytes)), ['Example.md']);
  assert.equal(result.failedCount, 0);
  window.close();
});
