import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBrowserAdapter } from '../extension/browser/chrome.js';

test('one image adapter enforces a shared export budget and reports tab failures', async () => {
  const requests = [];
  const progress = [];
  const mib = 1024 * 1024;
  const browser = createBrowserAdapter({
    chrome: {
      scripting: {
        executeScript: async (request) => {
          requests.push(request);

          if (request.args[0][0].endsWith('missing')) {
            throw new Error('tab unavailable');
          }

          return [
            {
              result: [
                {
                  url: request.args[0][0],
                  type: 'image/png',
                  bytes: [1],
                  transferredBytes: 40 * mib,
                },
              ],
            },
          ];
        },
      },
    },
  });
  const result = await browser.downloadImages(
    7,
    ['https://example.com/one', 'https://example.com/missing'],
    (count) => progress.push(count)
  );
  assert.deepEqual(progress, [0, 1, 2]);
  assert.equal(requests[0].args[1], 50 * mib);
  assert.equal(requests[1].args[1], 10 * mib);
  assert.ok(requests.every((request) => request.world === 'MAIN'));
  assert.equal(result[1].reason, 'tabAccess');
});
