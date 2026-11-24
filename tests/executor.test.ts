import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDBFactory } from 'fake-indexeddb';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { createTaskRepository } from '../extension/queue/repository.ts';
import { createExportExecutor } from '../extension/background/executor.ts';
import { createOffscreenProcessor } from '../extension/offscreen/processor.ts';
import { downloadPageImages } from '../extension/browser/download-images.ts';
import { createExportState } from '../core/notion/export-state.ts';
import { exportNotionArticle } from '../core/notion/notion-export.ts';
import { mockNotionApi } from './api-helper.ts';
import { mockLocks } from './storage-helper.ts';

const snapshot = (content = '<p>Saved text</p>') => ({
  article: {
    title: 'Article',
    content,
    url: 'https://example.com/article',
    baseUrl: 'https://example.com/',
  },
  title: 'Export title',
  tabId: 7,
  documentId: 'source-document',
  locale: 'en' as const,
  options: { sourceLabel: 'Source' },
});
function fixture(t) {
  const factory = new IDBFactory();
  const tasks = createTaskRepository({ factory });
  const { window } = new JSDOM('');
  const locks = mockLocks();
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  const downloads: any[] = [];
  const imageRequests: any[] = [];
  const state = {
    connected: true,
    imageFailure: false,
    starts: 0,
    creates: 0,
    writes: 0,
    rejectDownload: false,
  };
  const api = mockNotionApi({
    createPage: async () => {
      state.creates++;
      return { id: 'page' };
    },
    writeMarkdown: async () => {
      state.writes++;
    },
  });
  const processor = createOffscreenProcessor({
    tasks,
    document: window.document,
    translate: async () => (key) => key,
    urls: {
      createObjectURL: (blob) => {
        const url = `blob:chrome-extension://test/${blobs.size + 1}`;
        blobs.set(url, blob as Blob);
        return url;
      },
      revokeObjectURL: (url) => {
        revoked.push(url);
      },
    },
  });
  const options = {
    tasks,
    connected: async () => state.connected,
    api: () => api,
    translate: async () => (key: string) => key,
    offscreen: async <T>(message): Promise<T> => {
      if (message.type === 'activity') {
        return undefined as T;
      }

      if (message.type === 'release') {
        processor.release(message.taskId);
        return undefined as T;
      }

      return (await processor.process(message.type, message.taskId, message.attemptId)) as T;
    },
    images: (source, urls, progress) =>
      downloadPageImages(
        {
          executeScript: async (request) => {
            imageRequests.push(request);
            assert.deepEqual(request.target, { tabId: 7, documentIds: ['source-document'] });

            if (state.imageFailure) {
              throw new Error('Document changed');
            }

            return [
              {
                result: request.args[0].map((url) => ({
                  url,
                  type: 'image/png',
                  bytes: [1, 2, 3],
                })),
              },
            ];
          },
        },
        source.tabId,
        urls,
        progress,
        source.documentId
      ),
    downloads: {
      download: async (request) => {
        state.starts++;

        if (state.rejectDownload) {
          throw new Error('Download response lost');
        }

        const item = { id: state.starts, state: 'in_progress', ...request };
        downloads.push(item);
        return item.id;
      },
      search: async (query) =>
        downloads.filter((item) =>
          query.id !== undefined ? item.id === query.id : item.url === query.url
        ),
    } as any,
    exclusive: async (action) => {
      await locks.request('executor', action);
    },
    publish: async () => {},
  };
  const executor = () => createExportExecutor(options);
  const add = (type: 'archive' | 'notion', commandId: string, source = snapshot()) =>
    tasks.enqueue(
      type === 'archive'
        ? { type, commandId, snapshot: source }
        : {
            type,
            commandId,
            snapshot: source,
            integration: {
              id: 'notion',
              name: 'Original integration',
              parentId: 'original-parent',
            },
          }
    );
  t.after(async () => {
    window.close();
    await tasks.close();
  });
  return {
    tasks,
    processor,
    state,
    blobs,
    revoked,
    downloads,
    imageRequests,
    api,
    executor,
    add,
    options,
  };
}

test('ZIP continues without popup, survives worker replacement and finishes only when Chrome finishes', async (t) => {
  const f = fixture(t);
  f.state.imageFailure = true;
  const id = await f.add('archive', 'zip', snapshot('<p>Saved text</p><img src="/image.png">'));
  await f.executor().run();
  assert.equal((await f.tasks.get(id)).status, 'running');
  const files = unzipSync(new Uint8Array(await [...f.blobs.values()][0].arrayBuffer()));
  assert.ok(strFromU8(files['Article.md']).includes('Saved text'));
  assert.ok(files['missing-images.txt']);
  await f.executor().run();
  assert.equal(f.state.starts, 1);
  f.downloads[0].state = 'complete';
  await f.executor().run();
  const task = await f.tasks.get(id);
  assert.equal(task.status, 'completed');
  assert.equal(task.result.failedCount, 1);
  assert.equal((await f.tasks.loadPayload(id)).checkpoint, undefined);
  assert.deepEqual(f.revoked, [f.downloads[0].url]);
});

test('interrupted downloads require explicit retry; an unknown start is never replayed', async (t) => {
  const f = fixture(t);
  const id = await f.add('archive', 'zip');
  await f.executor().run();
  f.downloads[0].state = 'interrupted';
  await f.executor().run();
  assert.equal((await f.tasks.get(id)).status, 'failed');
  await f.tasks.retry(id);
  await f.executor().run();
  assert.equal(f.state.starts, 2);
  f.downloads[1].state = 'complete';
  await f.executor().run();
  f.state.rejectDownload = true;
  const unknown = await f.add('archive', 'unknown');
  await f.executor().run();
  assert.equal((await f.tasks.get(unknown)).status, 'needs_review');
  await f.executor().run();
  assert.equal(f.state.starts, 3);
  await assert.rejects(f.tasks.retry(unknown), /queueTaskNotRetryable/);
});

test('tasks awaiting credentials do not block ready exports and resume at the original destination', async (t) => {
  const f = fixture(t);
  f.state.connected = false;
  const waiting = await f.add('notion', 'notion');
  const archive = await f.add('archive', 'archive');
  await f.executor().run();
  assert.equal((await f.tasks.get(waiting)).status, 'waiting_credentials');
  assert.equal((await f.tasks.get(archive)).status, 'running');
  f.downloads[0].state = 'complete';
  f.state.connected = true;
  f.api.createPage = async (parent) => {
    assert.equal(parent, 'original-parent');
    return { id: 'page' };
  };
  await f.executor().run();
  assert.equal((await f.tasks.get(waiting)).status, 'completed');
});

test('confirmed Notion checkpoints resume without creating a page or rewriting text; unknown creation needs review', async (t) => {
  const f = fixture(t);
  const confirmed = await f.add('notion', 'confirmed');
  const claimed = await f.tasks.claimNext();
  const state = createExportState({
    markdown: 'Saved Markdown',
    occurrences: [],
    initialFailures: 0,
  });
  Object.assign(state, {
    page: { id: 'existing-page' },
    creation: 'confirmed',
    writing: 'confirmed',
    downloading: 'confirmed',
  });
  await f.tasks.saveCheckpoint(confirmed, claimed.attemptId, { type: 'notion', state });
  await f.executor().run();
  assert.equal((await f.tasks.get(confirmed)).result.pageId, 'existing-page');
  assert.equal(f.state.creates, 0);
  assert.equal(f.state.writes, 0);
  const uncertain = await f.add('notion', 'uncertain');
  const attempt = await f.tasks.claimNext();
  const unknown = createExportState({ markdown: 'Text', occurrences: [], initialFailures: 0 });
  unknown.creation = 'uncertain';
  await f.tasks.saveCheckpoint(uncertain, attempt.attemptId, { type: 'notion', state: unknown });
  await f.executor().run();
  assert.equal((await f.tasks.get(uncertain)).status, 'needs_review');
  assert.equal(f.state.creates, 0);
});

test('a failed checkpoint prevents an external request and concurrent schedulers execute one attempt', async (t) => {
  const f = fixture(t);
  const id = await f.add('notion', 'save');
  await Promise.all([f.executor().run(), f.executor().run()]);
  assert.equal((await f.tasks.get(id)).status, 'completed');
  assert.equal(f.state.creates, 1);
  const state = createExportState({ markdown: 'Text', occurrences: [], initialFailures: 0 });
  let creates = 0;
  await assert.rejects(
    exportNotionArticle({
      state,
      api: mockNotionApi({
        createPage: async () => {
          creates++;
          return { id: 'page' };
        },
      }),
      title: 'Title',
      parentId: 'parent',
      downloadImages: async () => [],
      formatImageError: () => 'error',
      checkpoint: async () => {
        throw new Error('Disk unavailable');
      },
    }),
    /Disk unavailable/
  );
  assert.equal(creates, 0);
});

test('a lost marker deletion response is recovered without another deletion or page creation', async (t) => {
  const f = fixture(t);
  const blocks: any[] = [];
  let deletes = 0;
  f.api.writeMarkdown = async (_id, markdown) => {
    f.state.writes++;
    const marker = markdown.match(/H2MDIMAGE[a-zA-Z0-9]+END/)[0];
    blocks.push({
      id: 'marker',
      type: 'paragraph',
      paragraph: { rich_text: [{ plain_text: marker }] },
    });
  };
  f.api.children = async () => blocks;
  f.api.uploadImage = async () => 'upload';
  f.api.appendImage = async () => {
    blocks.push({ id: 'image', type: 'image' });
    return 'image';
  };
  f.api.setCaption = async () => {};
  f.api.removeBlock = async () => {
    deletes++;
    blocks.shift();
    throw Object.assign(new Error('Response lost'), { code: 'notionSaveError', ambiguous: true });
  };
  const id = await f.add('notion', 'cleanup', snapshot('<p>Text</p><img src="/image.png">'));
  await f.executor().run();
  assert.equal((await f.tasks.get(id)).status, 'completed');
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.writes, 1);
  assert.equal(deletes, 1);
});

test('a persisted uncertain image insertion is reconciled by its marker without a second insertion', async () => {
  const state = createExportState({
    markdown: 'Text',
    initialFailures: 0,
    occurrences: [
      {
        marker: 'MARKER',
        url: 'image',
        alt: 'Alt',
        status: 'pending',
        insertion: 'pending',
        cleanup: 'pending',
        blockId: 'marker',
        blockType: 'paragraph',
        parentId: 'page',
      },
    ],
  });
  Object.assign(state, {
    creation: 'confirmed',
    writing: 'confirmed',
    downloading: 'confirmed',
    page: { id: 'page' },
  });
  state.assets.set('image', { image: { url: 'image', bytes: [1] }, uploadId: 'upload' });
  let saved = structuredClone(state);
  let insertions = 0;
  const blocks: any[] = [
    { id: 'marker', type: 'paragraph', paragraph: { rich_text: [{ plain_text: 'MARKER' }] } },
  ];
  const api = mockNotionApi({
    children: async () => blocks,
    appendImage: async () => {
      insertions++;
      blocks.push({ id: 'image', type: 'image', image: { caption: [{ plain_text: 'MARKER' }] } });
      return 'image';
    },
    setCaption: async () => {},
    removeBlock: async () => {
      blocks.shift();
    },
  });
  const run = (current, checkpoint?) =>
    exportNotionArticle({
      state: current,
      api,
      title: 'Title',
      parentId: 'parent',
      downloadImages: async () => [],
      formatImageError: () => 'error',
      checkpoint,
    });
  await assert.rejects(
    run(state, async () => {
      if (state.occurrences[0].insertion === 'confirmed') {
        throw new Error('Stopped after insertion');
      }

      saved = structuredClone(state);
    }),
    /Stopped after insertion/
  );
  assert.equal(saved.occurrences[0].insertion, 'uncertain');
  await run(saved);
  assert.equal(insertions, 1);
  assert.equal(saved.occurrences[0].status, 'complete');
});
