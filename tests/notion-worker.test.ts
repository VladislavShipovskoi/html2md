import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createNotionClient, NOTION_CHANNEL } from '../extension/browser/notion-client.ts';
import { mockStorage } from './storage-helper.ts';
import { mockWorker } from './worker-helper.ts';

const pageId = '123456781234123412341234567890ab';
const uploadId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
function fixture(fetcher) {
  const storage = mockStorage(
    { integrations: [{ id: 'notion', name: 'Notion', type: 'notion', parentId: pageId }] },
    { 'integrationToken:notion': 'private-token' }
  );
  const worker = mockWorker({ ...storage, fetcher });
  return { ...worker, ...storage, api: createNotionClient(worker, 'notion') };
}

test('Notion operations run through worker with JSON-safe images and no credentials in messages', async () => {
  const requests: string[] = [];
  const worker = fixture(async (url, options) => {
    assert.equal(options.headers.Authorization, 'Bearer private-token');
    assert.ok(url.startsWith('https://api.notion.com/v1/'));
    requests.push(url);
    let value = {};

    if (url.endsWith('/pages')) {
      value = { id: pageId, ignored: 'response body' };
    }

    if (url.endsWith('/file_uploads')) {
      value = { id: uploadId };
    }

    if (url.endsWith('/send')) {
      assert.ok(options.body instanceof FormData);
      const file = options.body.get('file') as Blob;
      assert.deepEqual(new Uint8Array(await file.arrayBuffer()), new Uint8Array([1, 2, 3]));
      value = { status: 'uploaded' };
    }

    if (url.endsWith('/children')) {
      value = { results: options.method === 'GET' ? [] : [{ id: pageId }] };
    }

    return { ok: true, json: async () => value };
  });
  assert.deepEqual(await worker.api.createPage(pageId, 'Title'), { id: pageId });
  await worker.api.writeMarkdown(pageId, 'Text');
  assert.deepEqual(await worker.api.children(pageId), []);
  assert.equal(
    await worker.api.uploadImage({
      url: 'https://example.com/a.png',
      type: 'image/png',
      bytes: new Uint8Array([1, 2, 3]),
    }),
    uploadId
  );
  assert.equal(
    await worker.api.appendImage({
      targetId: pageId,
      markerId: pageId,
      uploadId,
      marker: 'marker',
    }),
    pageId
  );
  await worker.api.setCaption(pageId, 'Caption');
  await worker.api.clearMarker(pageId, 'paragraph');
  await worker.api.removeBlock(pageId);
  await worker.api.writeImageError(pageId, 'paragraph', 'Image unavailable');
  assert.equal(requests.length, 10);
  assert.ok(!JSON.stringify([worker.requests, worker.responses]).includes('private-token'));
});

test('worker rejects foreign senders, unknown operations, unsafe IDs and malformed images before fetch', async () => {
  const worker = fixture(async () => {
    assert.fail('Unexpected fetch');
  });
  const message = {
    channel: NOTION_CHANNEL,
    integrationId: 'notion',
    operation: 'createPage',
    args: [pageId, 'Title'],
  };

  for (const sender of [
    worker.sender('options.html'),
    { id: 'other', url: worker.sender().url },
    { id: 'test', url: 'https://example.com/' },
  ]) {
    assert.equal((await worker.sendMessage(message, sender)).ok, false);
  }

  for (const fields of [
    { operation: 'fetch', args: ['https://example.com/'] },
    { operation: 'children', args: ['../../users'] },
    { operation: 'writeImageError', args: [pageId, '__proto__', 'text'] },
    { operation: 'uploadImage', args: [{ url: 'image', type: 'image/png', bytes: [256] }] },
  ]) {
    assert.equal((await worker.sendMessage({ ...message, ...fields })).ok, false);
  }
});

test('missing tokens and ambiguous failures cross the boundary safely without automatic replay', async () => {
  let requests = 0;
  const worker = fixture(async () => {
    requests++;
    return {
      ok: false,
      status: 503,
      json: async () => ({ message: 'private-token in server error' }),
    };
  });
  await assert.rejects(
    worker.api.createPage(pageId, 'Title'),
    (error: any) =>
      error.code === 'notionSaveError' && error.status === 503 && error.ambiguous === true
  );
  assert.equal(requests, 1);
  assert.ok(!JSON.stringify(worker.responses).includes('private-token'));
  await worker.repository.forgetToken('notion');
  await assert.rejects(worker.api.createPage(pageId, 'Title'), /notionMissingToken/);
  assert.equal(requests, 1);
  const disconnected = createNotionClient(
    {
      sendMessage: async () => {
        throw new Error('private-token in transport error');
      },
    },
    'notion'
  );
  await assert.rejects(
    disconnected.createPage(pageId, 'Title'),
    (error: any) =>
      error.code === 'notionSaveError' &&
      error.ambiguous === true &&
      !error.message.includes('private-token')
  );
  await assert.rejects(disconnected.children(pageId), (error: any) => error.ambiguous === false);
});
