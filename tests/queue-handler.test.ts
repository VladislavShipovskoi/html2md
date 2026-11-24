import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createTaskRepository } from '../extension/queue/repository.ts';
import { createIntegrationRepository } from '../extension/integrations/integrations.ts';
import { createQueueHandler } from '../extension/background/queue-handler.ts';
import { createQueueClient } from '../extension/queue/commands.ts';
import { mockStorage } from './storage-helper.ts';

test('queue commands use the saved destination, deduplicate acknowledgements and reject web senders', async (t) => {
  const tasks = createTaskRepository({ factory: new IDBFactory() });
  t.after(() => tasks.close());
  const integrations = createIntegrationRepository({ ...mockStorage(), createId: () => 'notion' });
  await integrations.initialize();
  const parentId = '123456781234123412341234567890ab';
  await integrations.save({ name: 'Original', parentId, token: 'private-token' });
  const runtime = { id: 'test', getURL: (path: string) => 'chrome-extension://test/' + path };
  const handler = createQueueHandler({
    tasks,
    integrations,
    runtime,
    wake: () => {},
    publish: async () => {},
  });
  const from = { id: 'test', url: runtime.getURL('side-panel.html') };
  const responses: unknown[] = [];
  const send = (message, sender = from): Promise<any> =>
    new Promise((resolve) => {
      assert.equal(
        handler(message, sender, (response) => {
          responses.push(response);
          resolve(response);
        }),
        true
      );
    });
  const client = createQueueClient({ sendMessage: send });
  const input = {
    commandId: 'click',
    type: 'notion' as const,
    integrationId: 'notion',
    snapshot: {
      article: {
        title: 'Article',
        content: '<p>Text</p>',
        url: 'https://example.com',
        baseUrl: 'https://example.com',
      },
      title: 'Title',
      tabId: 7,
      documentId: 'source',
      locale: 'en' as const,
      options: { sourceLabel: 'Source' },
    },
  };
  const id = await client.enqueue(input);
  await integrations.save({
    id: 'notion',
    name: 'Changed',
    parentId: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    token: '',
  });
  assert.equal(await client.enqueue(input), id);
  const task = await tasks.get(id);
  assert.ok(task.type === 'notion');
  assert.equal(task.integration.parentId, parentId);
  assert.equal(task.integration.name, 'Original');
  assert.ok(!JSON.stringify(responses).includes('private-token'));
  const rejected = await send(
    { channel: 'html2md-queue', type: 'enqueue', input },
    { id: 'test', url: 'https://example.com/' }
  );
  assert.equal(rejected.ok, false);
  assert.equal((await tasks.list()).length, 1);
});
