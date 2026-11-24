import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { createTaskRepository } from '../extension/queue/repository.ts';
import type { NewExportTask } from '../extension/queue/types.ts';
import { createExportState } from '../core/notion/export-state.ts';

const source = () => ({
  article: {
    title: 'Article',
    content: '<p>Saved article</p>',
    url: 'https://example.com/article',
    baseUrl: 'https://example.com/',
  },
  title: 'Export title',
  tabId: 7,
  documentId: 'original-document',
  locale: 'en' as const,
  options: { sourceLabel: 'Source' },
});
const archive = (commandId: string): NewExportTask => ({
  type: 'archive',
  commandId,
  snapshot: source(),
});
const notion = (commandId: string): NewExportTask => ({
  type: 'notion',
  commandId,
  snapshot: source(),
  integration: { id: 'notion', name: 'Notion', parentId: 'parent' },
});
function setup(t) {
  const factory = new IDBFactory();
  let sequence = 0;
  const repositories: ReturnType<typeof createTaskRepository>[] = [];
  const open = (createId = () => `id-${++sequence}`) => {
    const repository = createTaskRepository({ factory, createId, now: () => 100 });
    repositories.push(repository);
    return repository;
  };
  t.after(async () => {
    for (const repository of repositories) {
      await repository.close();
    }
  });
  return { open };
}

test('snapshots persist independently of caller changes and duplicate commands create one task', async (t) => {
  const { open } = setup(t);
  const first = open();
  const second = open();
  const snapshot = source();
  const integration = {
    id: 'notion',
    name: 'Original',
    parentId: 'parent',
    token: 'private-token',
  };
  const input: NewExportTask = { type: 'notion', commandId: 'click', snapshot, integration };
  const pending = first.enqueue(input);
  snapshot.article.content = '<p>Changed article</p>';
  integration.parentId = 'different-parent';
  const id = await pending;
  const duplicate = await Promise.all([first.enqueue(input), second.enqueue(input)]);
  assert.deepEqual(duplicate, [id, id]);
  assert.equal((await first.list()).length, 1);
  assert.equal((await first.get(id)).type, 'notion');
  assert.equal((await first.loadPayload(id)).snapshot.article.content, '<p>Saved article</p>');
  const task = await first.get(id);
  assert.ok(task.type === 'notion');
  assert.equal(task.integration.parentId, 'parent');
  assert.ok(!JSON.stringify(task).includes('private-token'));
  assert.ok(!JSON.stringify(task).includes('Saved article'));
  const payload = await second.loadPayload(id);
  assert.ok(!JSON.stringify(payload).includes('private-token'));
  await first.close();
  await second.close();
  assert.deepEqual(await open().get(id), task);
  assert.deepEqual(await open().loadPayload(id), payload);
  assert.notEqual(await first.enqueue({ ...input, commandId: 'another-click' }), id);
});

test('FIFO claiming is exclusive across contexts; waiting tasks do not block and retries go last', async (t) => {
  const { open } = setup(t);
  const first = open();
  const second = open();
  const a = await first.enqueue(notion('a'));
  const b = await first.enqueue(archive('b'));
  const claims = await Promise.all([first.claimNext(), second.claimNext()]);
  assert.equal(claims.filter(Boolean).length, 1);
  const active = claims.find(Boolean)!;
  assert.equal(active.id, a);
  await assert.rejects(first.remove(a), /queueTaskRunning/);
  const c = await second.enqueue(archive('c'));
  assert.equal(await first.claimNext(), undefined);
  await first.update(a, active.attemptId!, { status: 'waiting_credentials' });
  const next = (await second.claimNext())!;
  assert.equal(next.id, b);
  await second.update(b, next.attemptId!, {
    status: 'failed',
    error: { code: 'notionRateLimited', retryable: true },
  });
  await first.retry(b);
  const third = (await first.claimNext())!;
  assert.equal(third.id, c);
  await first.update(c, third.attemptId!, { status: 'completed', result: { failedCount: 0 } });
  await first.resume(a);
  const resumed = (await first.claimNext())!;
  assert.equal(resumed.id, a);
  assert.notEqual(resumed.attemptId, active.attemptId);
  await assert.rejects(
    second.update(a, active.attemptId!, { status: 'completed' }),
    /queueStaleAttempt/
  );
  await first.update(a, resumed.attemptId!, { status: 'completed' });
  assert.equal((await first.claimNext())!.id, b);
});

test('checkpoints restore Maps and bytes; completion frees temporary data but keeps the snapshot', async (t) => {
  const { open } = setup(t);
  const repository = open();
  const id = await repository.enqueue(notion('notion'));
  const task = (await repository.claimNext())!;
  const state = createExportState({ markdown: 'Markdown', occurrences: [], initialFailures: 0 });
  state.assets.set('image', {
    image: { url: 'image', bytes: new Uint8Array([1, 2, 3]) },
    uploadId: 'upload',
  });
  const saved = repository.saveCheckpoint(id, task.attemptId!, { type: 'notion', state });
  state.assets.clear();
  await saved;
  await repository.close();
  const reopened = open();
  const checkpoint = (await reopened.loadPayload(id)).checkpoint;
  assert.equal(checkpoint?.type, 'notion');

  if (checkpoint?.type !== 'notion') {
    assert.fail('Missing Notion checkpoint');
  }

  assert.deepEqual(checkpoint.state.assets.get('image')!.image.bytes, new Uint8Array([1, 2, 3]));
  await reopened.update(id, task.attemptId!, {
    status: 'completed',
    result: { failedCount: 0, pageId: 'page' },
  });
  assert.equal((await reopened.loadPayload(id)).checkpoint, undefined);
  assert.equal((await reopened.loadPayload(id)).snapshot.documentId, 'original-document');
  const queued = await reopened.enqueue(archive('queued'));
  await reopened.clearCompleted();
  assert.deepEqual(
    (await reopened.list()).map((item) => item.id),
    [queued]
  );
  await assert.rejects(reopened.loadPayload(id), /queueTaskNotFound/);
  // A delayed duplicate must not resurrect an explicitly removed task.
  assert.equal(await reopened.enqueue(notion('notion')), id);
  assert.equal((await reopened.list()).length, 1);
});

test('review and unsafe failures cannot be retried, while safe failures retain their ZIP checkpoint', async (t) => {
  const { open } = setup(t);
  const repository = open();
  const id = await repository.enqueue(archive('archive'));
  const task = (await repository.claimNext())!;
  const checkpoint = {
    type: 'archive' as const,
    archive: { bytes: new Uint8Array([4, 5]), filename: 'article.zip', failedCount: 0 },
  };
  await repository.saveCheckpoint(id, task.attemptId!, checkpoint);
  await repository.update(id, task.attemptId!, {
    status: 'failed',
    error: { code: 'downloadError', retryable: false },
  });
  await assert.rejects(repository.retry(id), /queueTaskNotRetryable/);
  // Unsafe failures cannot acquire another attempt; remove and create a new intentional task.
  await repository.remove(id);
  const safeId = await repository.enqueue(archive('safe'));
  const safe = (await repository.claimNext())!;
  await repository.saveCheckpoint(safeId, safe.attemptId!, checkpoint);
  await repository.update(safeId, safe.attemptId!, {
    status: 'failed',
    error: { code: 'downloadError', retryable: true },
  });
  await repository.retry(safeId);
  const retried = (await repository.claimNext())!;
  await assert.rejects(
    repository.saveCheckpoint(safeId, safe.attemptId!, checkpoint),
    /queueStaleAttempt/
  );
  assert.deepEqual((await repository.loadPayload(safeId)).checkpoint, checkpoint);
  await repository.update(safeId, retried.attemptId!, {
    status: 'needs_review',
    error: { code: 'notionImageUncertain', retryable: true },
  });
  await assert.rejects(repository.retry(safeId), /queueTaskNotRetryable/);
  await repository.clearCompleted();
  assert.equal((await repository.get(safeId)).status, 'needs_review');
});

test('failed writes roll back task data, command receipt and FIFO order together', async (t) => {
  const { open } = setup(t);
  const collision = open(() => 'same-id');
  const id = await collision.enqueue(archive('original'));
  await assert.rejects(collision.enqueue(archive('failed-command')), /^Error: queueStorageError$/);
  assert.deepEqual(
    (await collision.list()).map((task) => task.id),
    [id]
  );
  assert.equal((await collision.loadPayload(id)).snapshot.article.content, '<p>Saved article</p>');
  const repository = open();
  const retried = await repository.enqueue(archive('failed-command'));
  assert.notEqual(retried, id);
  assert.equal((await repository.get(retried)).order, 2);
  assert.equal((await repository.list()).length, 2);
});
