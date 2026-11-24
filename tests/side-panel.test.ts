import { mockStorage } from './storage-helper.ts';
import { mockWorker } from './worker-helper.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeSidePanel } from '../extension/side-panel/side-panel.ts';
import { createRuntimeServices } from '../extension/shared/runtime.ts';
const locale = 'en';
const html = await readFile(
  new URL('../extension/side-panel/side-panel.html', import.meta.url),
  'utf8'
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function sourceEvent() {
  const listeners = new Set<(...args: any[]) => void>();
  return {
    addListener: (listener) => {
      listeners.add(listener);
    },
    removeListener: (listener) => {
      listeners.delete(listener);
    },
    emit: (...args) => listeners.forEach((listener) => listener(...args)),
    listeners,
  };
}
async function openPanel(t, options: Record<string, any> = {}) {
  const { window } = new JSDOM(html);
  const locale = options.locale ?? 'en';
  const messages = JSON.parse(
    await readFile(
      new URL('../extension/_locales/' + locale + '/messages.json', import.meta.url),
      'utf8'
    )
  );
  const translate = (key: string, value?: string | string[]) => {
    if (key === '@@ui_locale') {
      return locale;
    }

    assert.ok(messages[key], 'Missing translation: ' + key);
    const substitutions = Array.isArray(value) ? value : [value];
    return messages[key].message.replace(
      /\$([A-Z]+)\$/g,
      (_, name) =>
        substitutions[
          Number(messages[key].placeholders[name.toLowerCase()].content.slice(1)) - 1
        ] ?? ''
    );
  };
  const article = {
    supported: true,
    articleFound: true,
    title: 'Article',
    characters: 1234,
    content: '<p>Example text</p>',
    url: 'https://example.com',
    baseUrl: 'https://example.com',
    ...options.article,
  };
  const state: Record<string, any> = {
    downloads: [],
    revoked: [],
    timers: [],
    copied: null,
    blob: null,
    enqueued: [],
    tasks: options.tasks ?? [],
  };
  const { storage, locks } = mockStorage(
    { notionParentId: options.notion?.parentId },
    { notionToken: options.notion?.token }
  );
  const worker = mockWorker({
    storage,
    locks,
    fetcher: async (...args) => {
      assert.ok(state.fetcher, 'Unexpected API request');
      return state.fetcher(...args);
    },
  });
  const events = options.events ?? {
    activated: sourceEvent(),
    updated: sourceEvent(),
    messages: sourceEvent(),
  };
  state.events = events;
  state.queries = [];
  const chrome = {
    storage: {
      local: {
        get: async (key) => {
          assert.equal(key, 'theme');
          return storage.local.get(key);
        },
        set: storage.local.set,
      },
    },
    i18n: { getMessage: translate },
    runtime: {
      id: 'test',
      getURL: (path) => 'chrome-extension://test/' + path,
      onMessage: events.messages,
      sendMessage: worker.sendMessage,
      openOptionsPage: async () => {
        state.optionsOpened = true;
      },
    },
    windows: { getCurrent: async () => ({ id: options.windowId ?? 10 }) },
    tabs: {
      onActivated: events.activated,
      onUpdated: events.updated,
      query: async (query) => {
        state.queries.push(query);
        return (
          state.tabs ??
          options.tabs ?? [{ id: 7, url: 'https://example.com', title: options.tabTitle }]
        );
      },
    },
    scripting: {
      executeScript: async (request) => {
        if (request.files) {
          if (state.analyze) {
            return state.analyze();
          }

          if (options.analysisError) {
            throw new Error('Access denied');
          }

          return options.analysisResponse ?? [{ result: article, documentId: 'original-document' }];
        }

        assert.equal(request.target.tabId, 7);
        assert.equal(request.world, 'MAIN');
        state.imageRequest = request;

        if (options.imageError) {
          throw new Error('Tab closed');
        }

        if (options.imageResponse) {
          return options.imageResponse;
        }

        return [
          { result: request.args[0].map((url) => ({ url, type: 'image/png', bytes: [1, 2, 3] })) },
        ];
      },
    },
    downloads: {
      download: async (request) => {
        if (options.downloadError) {
          throw new Error('Download denied');
        }

        state.downloads.push(request);
        return 1;
      },
    },
  };
  class PanelURL extends URL {
    static createObjectURL(blob) {
      state.blob = blob;
      return 'blob:archive';
    }
    static revokeObjectURL(url) {
      state.revoked.push(url);
    }
  }
  const services = createRuntimeServices({
    document: window.document,
    chrome,
    crypto,
    URL: PanelURL,
    Blob,
    navigator: {
      clipboard: {
        writeText: async (text) => {
          if (options.copyError) {
            throw new Error('Clipboard denied');
          }

          state.copied = text;
        },
      },
    },
    setTimeout: (callback, delay) => {
      state.timers.push({ callback, delay });
      return 1;
    },
  });
  t.after(() => window.close());
  await initializeSidePanel({
    ...services,
    queue: {
      ...services.queue,
      list: async () => state.tasks,
      enqueue: async (input) => {
        if (options.enqueueError) {
          throw new Error('queueStorageError');
        }

        state.enqueued.push(input);
        return 'task-' + state.enqueued.length;
      },
      subscribe: (listener) => {
        state.showTasks = listener;
        return () => {
          state.unsubscribed = true;
        };
      },
    },
  });
  await flush();
  t.after(() => {
    assert.ok(
      !JSON.stringify([worker.requests, worker.responses]).includes(
        options.notion?.token ?? 'private-token'
      )
    );
  });
  const element = (selector) => window.document.querySelector(selector);
  return {
    window,
    element,
    state,
    translate,
    async click(selector) {
      element(selector).click();
      await flush();
    },
  };
}

test(`panel: conversion, copying, ZIP and localization (${locale})`, async (t) => {
  const panel = await openPanel(t, { locale });
  assert.equal(panel.window.document.documentElement.lang, locale);
  assert.equal(panel.element('#status').textContent, panel.translate('conversionAvailable'));
  assert.equal(
    panel.element('#text-count').textContent,
    panel.translate('characterCount', (1234).toLocaleString(locale))
  );
  await panel.click('#convert');
  assert.equal(panel.element('#output').hidden, false);
  assert.equal(panel.element('#convert').hidden, true);
  await panel.click('#copy');
  assert.equal(panel.state.copied, panel.element('#preview').value);
  await panel.click('#download');
  assert.equal(panel.state.enqueued[0].type, 'archive');
  assert.ok(panel.state.enqueued[0].snapshot.article.content.includes('Example text'));
  assert.equal(panel.state.enqueued[0].snapshot.documentId, 'original-document');
  assert.equal(panel.element('#download').disabled, false);
  assert.equal(panel.state.downloads.length, 0);
});

const analysisCases: [string, Record<string, any>, string][] = [
  ['no tab', { tabs: [] }, 'noActiveTab'],
  ['restricted page', { tabs: [{ id: 7, url: 'chrome://extensions' }] }, 'restrictedPage'],
  [
    'web store',
    { tabs: [{ id: 7, url: 'https://chromewebstore.google.com/detail/example' }] },
    'restrictedPage',
  ],
  ['injection error', { analysisError: true }, 'panelGrantAccess'],
  ['unsupported document', { article: { supported: false } }, 'unsupportedDocument'],
  ['no article', { article: { articleFound: false } }, 'articleNotFound'],
];

for (const [name, options, message] of analysisCases) {
  test(`panel analysis: ${name}`, async (t) => {
    const panel = await openPanel(t, options);
    assert.equal(panel.element('#message').textContent, panel.translate(message));
    assert.equal(panel.element('#convert').hidden, true);
    assert.equal(panel.element('main').getAttribute('aria-busy'), 'false');
  });
}

for (const tabTitle of ['Tab title', undefined]) {
  test(`panel uses fallback title: ${tabTitle ?? 'untitled'}`, async (t) => {
    const panel = await openPanel(t, { article: { title: '' }, tabTitle });
    assert.equal(panel.element('#page-title').textContent, tabTitle ?? panel.translate('untitled'));
    await panel.click('#convert');
    assert.ok(
      panel.element('#preview').value.startsWith(`# ${tabTitle ?? panel.translate('untitled')}`)
    );
  });
}

test('panel reports conversion and clipboard failures', async (t) => {
  const panel = await openPanel(t, { article: { content: '' }, copyError: true });
  await panel.click('#convert');
  assert.equal(panel.element('#action-message').textContent, panel.translate('conversionError'));
  assert.equal(panel.element('#output').hidden, true);
  await panel.click('#copy');
  assert.equal(panel.element('#action-message').textContent, panel.translate('copyError'));
});

test('Notion without a session token prompts settings and makes no requests', async (t) => {
  const panel = await openPanel(t);
  panel.state.fetcher = () => {
    assert.fail('Unexpected API call');
  };
  await panel.click('#convert');
  await panel.click('#notion-save');
  assert.equal(
    panel.element('#notion-message').textContent,
    panel.translate('notionNeedsSettings')
  );
});

test('Russian panel renders translated actions', async (t) => {
  const panel = await openPanel(t, { locale: 'ru' });
  assert.equal(panel.window.document.documentElement.lang, 'ru');
  assert.equal(panel.element('#status').textContent, panel.translate('conversionAvailable'));
  assert.equal(panel.element('#notion-save').textContent.trim(), panel.translate('notionSave'));
});

test('panel queues a Notion snapshot, prevents double click and releases its subscription on close', async (t) => {
  const panel = await openPanel(t, {
    notion: { token: 'private-token', parentId: '123456781234123412341234567890ab' },
  });
  await panel.click('#convert');
  panel.element('#notion-save').click();
  panel.element('#notion-save').click();
  await flush();
  assert.equal(panel.state.enqueued.length, 1);
  const request = panel.state.enqueued[0];
  assert.equal(request.type, 'notion');
  assert.equal(request.integrationId, 'legacy-notion');
  assert.ok(!JSON.stringify(request).includes('private-token'));
  assert.equal(panel.element('#action-message').textContent, panel.translate('queueAdded'));
  panel.window.dispatchEvent(new panel.window.Event('pagehide'));
  assert.equal(panel.state.unsubscribed, true);
});

test('panel restores queue results and does not offer retry for an uncertain task', async (t) => {
  const panel = await openPanel(t, {
    tasks: [
      {
        id: 'saved',
        type: 'notion',
        title: 'Saved task',
        status: 'needs_review',
        integration: { name: 'Notion' },
        result: { pageId: '123456781234123412341234567890ab', failedCount: 0 },
      },
    ],
  });
  assert.equal(
    panel.element('#queue-list a').href,
    'https://app.notion.com/p/123456781234123412341234567890ab'
  );
  assert.equal(panel.window.document.querySelectorAll('#queue-list button').length, 1);
  assert.equal(panel.element('#queue-list button').textContent, panel.translate('queueRemove'));
});

test('navigation clears the preview and ignores stale analysis without changing queued snapshots', async (t) => {
  const panel = await openPanel(t);
  await panel.click('#convert');
  await panel.click('#download');
  const pending: ((value: any) => void)[] = [];
  panel.state.analyze = () => new Promise((resolve) => pending.push(resolve));
  const events = panel.state.events;
  events.updated.emit(7, { status: 'loading' }, { windowId: 10, active: true });
  assert.equal(panel.element('#output').hidden, true);
  await panel.click('#download');
  assert.equal(panel.state.enqueued.length, 1);
  events.activated.emit({ windowId: 10 });
  await flush();
  events.activated.emit({ windowId: 10 });
  await flush();
  const result = (title) => [
    {
      result: {
        supported: true,
        articleFound: true,
        title,
        characters: 10,
        content: '<p>' + title + '</p>',
        url: 'https://example.com',
        baseUrl: 'https://example.com',
      },
      documentId: title,
    },
  ];
  pending[1](result('New article'));
  await flush();
  pending[0](result('Old article'));
  await flush();
  assert.equal(panel.element('#page-title').textContent, 'New article');
  await panel.click('#convert');
  await panel.click('#download');
  assert.equal(panel.state.enqueued[0].snapshot.article.title, 'Article');
  assert.equal(panel.state.enqueued[1].snapshot.article.title, 'New article');
});

test('panels track their own window and release source listeners on close', async (t) => {
  const events = { activated: sourceEvent(), updated: sourceEvent(), messages: sourceEvent() };
  const first = await openPanel(t, { events, windowId: 10 });
  const second = await openPanel(t, { events, windowId: 20 });
  events.activated.emit({ windowId: 20 });
  await flush();
  assert.equal(first.state.queries.length, 1);
  assert.equal(second.state.queries.length, 2);
  assert.deepEqual(second.state.queries[1], { active: true, windowId: 20 });
  first.window.dispatchEvent(new first.window.Event('pagehide'));
  assert.equal(events.activated.listeners.size, 1);
  events.activated.emit({ windowId: 20 });
  await flush();
  assert.equal(second.state.queries.length, 3);
  assert.equal(first.state.unsubscribed, true);
});

test('clicking the extension icon refreshes an inaccessible source in the matching window', async (t) => {
  const panel = await openPanel(t, { tabs: [{ id: 7 }] });
  assert.equal(panel.element('#message').textContent, panel.translate('panelGrantAccess'));
  panel.state.tabs = [{ id: 7, url: 'https://example.com' }];
  panel.state.events.messages.emit(
    { channel: 'html2md-source-access', windowId: 10 },
    { id: 'test', url: 'chrome-extension://test/worker.js' },
    (response) => assert.deepEqual(response, { ok: true })
  );
  await flush();
  assert.equal(panel.element('#convert').hidden, false);
});
