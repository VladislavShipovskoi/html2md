import assert from 'node:assert/strict';
import { test } from 'node:test';
import { unzipSync, strFromU8 } from 'fflate';
import { JSDOM } from 'jsdom';
import { imageUrls, fetchImages as fetchNetworkImages, createArchive } from '../core/index.js';
const fetchImages = (urls, maxTotalBytes) =>
  fetchNetworkImages(urls, { fetcher: globalThis.fetch, credentials: 'include', maxTotalBytes });

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
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(options.credentials, 'include');

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
  assert.equal(results[1].reason, 'http');
  assert.equal(results[1].status, 404);
  assert.equal(results[2].reason, 'format');
  assert.equal(results[3].reason, 'network');
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

test('download failures still produce ZIP with valid local references for available images', async (t) => {
  const { window } = new JSDOM('');
  t.mock.method(
    globalThis,
    'fetch',
    async (url) =>
      new Response(
        url.endsWith('.svg') ? '<svg xmlns="http://www.w3.org/2000/svg"/>' : 'Not found',
        {
          status: url.endsWith('.svg') ? 200 : 404,
          headers: { 'content-type': url.endsWith('.svg') ? 'image/svg+xml' : 'text/plain' },
        }
      )
  );
  try {
    const urls = imageUrls(article, window.document);
    const images = await fetchImages(urls);
    const archive = createArchive(article, images, window.document, 'Source');
    const files = unzipSync(archive.bytes);
    const markdown = strFromU8(files['Example.md']);
    const localReferences = [...markdown.matchAll(/!\[[^\]]*\]\((images\/[^)]+)\)/g)].map(
      (match) => match[1]
    );
    assert.equal(localReferences.length, 2);
    assert.equal(new Set(localReferences).size, 1);

    for (const path of localReferences) {
      assert.ok(files[path]?.length, `Missing archive entry: ${path}`);
      assert.equal(strFromU8(files[path]), '<svg xmlns="http://www.w3.org/2000/svg"/>');
    }

    assert.equal(archive.failedCount, 1);
    assert.ok(markdown.includes('https://example.com/assets/missing.png'));
    assert.ok(strFromU8(files['missing-images.txt']).includes('missing.png'));
  } finally {
    window.close();
  }
});

test('ignores malformed image URLs and non-HTTP schemes', () => {
  const { window } = new JSDOM('');
  try {
    assert.deepEqual(
      imageUrls(
        {
          ...article,
          content:
            '<img src="http://["><img src="data:image/png;base64,AA=="><img src="blob:test"><img src="file:///image.png">',
        },
        window.document
      ),
      []
    );
  } finally {
    window.close();
  }
});

test('handles missing MIME, empty images, stream errors and timeout rejection', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) => {
    if (url.endsWith('/type')) {
      return new Response(new Uint8Array([1]));
    }

    if (url.endsWith('/empty')) {
      return new Response(new Uint8Array(), { headers: { 'content-type': 'image/png' } });
    }

    if (url.endsWith('/stream')) {
      return {
        ok: true,
        headers: new Headers({ 'content-type': 'image/png' }),
        body: {
          getReader: () => ({
            read: async () => {
              throw new Error('Stream failed');
            },
          }),
        },
      };
    }

    throw new DOMException('Timed out', 'TimeoutError');
  });
  const results = await fetchImages([
    'https://example.com/type',
    'https://example.com/empty',
    'https://example.com/stream',
    'https://example.com/timeout',
  ]);
  assert.ok(results.every((image) => image.failed));
});

test('combines multiple stream chunks and accepts MIME parameters', async (t) => {
  let reads = 0;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: true,
    headers: new Headers({ 'content-type': 'IMAGE/PNG; charset=binary' }),
    body: {
      getReader: () => ({
        read: async () =>
          reads++ === 0
            ? { value: new Uint8Array([1, 2]) }
            : reads === 2
              ? { value: new Uint8Array([3]) }
              : { done: true },
      }),
    },
  }));
  const [image] = await fetchImages(['https://example.com/image']);
  assert.equal(image.type, 'image/png');
  assert.deepEqual(image.bytes, [1, 2, 3]);
});

test('enforces image and total size boundaries and cancels oversized streams', async (t) => {
  const mib = 1024 * 1024;
  let cancellations = 0;
  // These tests exercise byte accounting, not copying: avoid allocating 50 MiB of fixtures.
  t.mock.method(globalThis, 'Uint8Array', function (size) {
    return {
      length: size,
      set() {},
      *[Symbol.iterator]() {
        yield 1;
      },
    };
  });
  t.mock.method(globalThis, 'fetch', async (url) => {
    let read = false;
    const size = Number(new URL(url).searchParams.get('size'));
    return {
      ok: true,
      headers: new Headers({ 'content-type': 'image/png' }),
      body: {
        getReader: () => ({
          read: async () => {
            if (read) {
              return { done: true };
            }

            read = true;
            return { value: { length: size } };
          },
          cancel: async () => {
            cancellations++;
          },
        }),
      },
    };
  });
  const imageUrl = (size) => `https://example.com/image?size=${size}`;
  const [atLimit] = await fetchImages([imageUrl(10 * mib)]);
  assert.ok(!atLimit.failed);
  const [oversized] = await fetchImages([imageUrl(10 * mib + 1)]);
  assert.equal(oversized.failed, true);
  const total = await fetchImages([...Array(5).fill(imageUrl(10 * mib)), imageUrl(1)]);
  assert.ok(total.slice(0, 5).every((image) => !image.failed));
  assert.equal(total[5].failed, true);
  assert.equal(total[5].reason, 'totalSize');
  assert.equal(cancellations, 1);
});

test('archives unknown image MIME and reports missing bytes', () => {
  const { window } = new JSDOM('');
  try {
    const archive = createArchive(
      article,
      [
        { url: 'https://example.com/assets/diagram.svg', type: 'image/custom', bytes: [1] },
        { url: 'https://example.com/assets/missing.png', bytes: [] },
        { url: 'https://example.com/no-bytes' },
      ],
      window.document,
      'Source'
    );
    const files = unzipSync(archive.bytes);
    assert.ok(files['images/image-1.img']);
    assert.equal(archive.failedCount, 2);
    assert.ok(strFromU8(files['Example.md']).includes('images/image-1.img'));
  } finally {
    window.close();
  }
});
