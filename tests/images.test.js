import assert from 'node:assert/strict';
import { test } from 'node:test';

import { fetchPageImages } from '../extension/browser/images.js';
const url =
  'https://web.shortcut.education/lms/_media/algo/basics/__/education/lecture_09/resources/tree-node.svg';
async function runFallback({
  tainted = false,
  maxTotalBytes = 50 * 1024 * 1024,
  width = 300,
  blobSize = 3,
} = {}) {
  let drawings = 0;
  const image = {
    currentSrc: url,
    src: url,
    complete: true,
    naturalWidth: width,
    naturalHeight: 100,
  };
  const context = {
    urls: [url],
    maxTotalBytes,
    AbortSignal,
    Uint8Array,
    fetch: async (request, options) => {
      assert.equal(request, url);
      assert.equal(options.credentials, 'include');
      throw new TypeError('Failed to fetch');
    },
    document: {
      images: [image],
      createElement: (tag) => {
        assert.equal(tag, 'canvas');
        return {
          getContext: () => ({
            drawImage: (target) => {
              assert.equal(target, image);
              drawings++;
            },
          }),
          toBlob: (callback) => {
            if (tainted) {
              throw new DOMException('Tainted', 'SecurityError');
            }

            callback(new Blob([new Uint8Array(blobSize)], { type: 'image/png' }));
          },
        };
      },
    },
  };
  const results = await fetchPageImages([url], maxTotalBytes, {
    document: context.document,
    fetcher: context.fetch,
  });
  return { results, drawings };
}
test('page image adapter exports a displayed LMS SVG as PNG after fetch failure', async () => {
  const { results, drawings } = await runFallback();
  assert.equal(drawings, 1);
  assert.equal(results[0].url, url);
  assert.equal(results[0].type, 'image/png');
  assert.deepEqual(Array.from(results[0].bytes), [0, 0, 0]);
  assert.equal(results[0].failed, undefined);
});
test('canvas fallback respects the byte budget and rejects tainted or oversized canvases', async () => {
  const limited = await runFallback({ maxTotalBytes: 2 });
  assert.equal(limited.results[0].reason, 'totalSize');
  const tainted = await runFallback({ tainted: true });
  assert.equal(tainted.results[0].reason, 'network');
  const large = await runFallback({ width: 200000 });
  assert.equal(large.drawings, 0);
  assert.equal(large.results[0].failed, true);
});
