import { mockStorage } from './storage-helper.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { initializePopup } from '../extension/popup/popup.ts';
import { createRuntimeServices } from '../extension/shared/runtime.ts';
const html = await readFile(new URL('../extension/popup/popup.html', import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));
async function openPopup(t, options: Record<string, any> = {}) {
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
  };
  const { storage, locks } = mockStorage(
    { notionParentId: options.notion?.parentId },
    { notionToken: options.notion?.token }
  );
  const chrome = {
    storage,
    i18n: { getMessage: translate },
    runtime: {
      openOptionsPage: async () => {
        state.optionsOpened = true;
      },
    },
    tabs: {
      query: async () =>
        options.tabs ?? [{ id: 7, url: 'https://example.com', title: options.tabTitle }],
    },
    scripting: {
      executeScript: async (request) => {
        if (request.files) {
          if (options.analysisError) {
            throw new Error('Access denied');
          }

          return options.analysisResponse ?? [{ result: article }];
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
  class PopupURL extends URL {
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
    URL: PopupURL,
    Blob,
    navigator: {
      locks,
      clipboard: {
        writeText: async (text) => {
          if (options.copyError) {
            throw new Error('Clipboard denied');
          }

          state.copied = text;
        },
      },
    },
    fetch: async (...args) => {
      assert.ok(state.fetcher, 'Unexpected API request');
      return state.fetcher(...args);
    },
    setTimeout: (callback, delay) => {
      state.timers.push({ callback, delay });
      return 1;
    },
  });
  t.after(() => window.close());
  await initializePopup(services);
  await flush();
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

test('Notion retries content on the created page using a session token', async (t) => {
  const id = '123456781234123412341234567890ab';
  const popup = await openPopup(t, {
    notion: { token: 'test-token', parentId: id },
    tabTitle: 'Original page title | Website',
  });
  const requests = [];
  let writes = 0;
  popup.state.fetcher = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });

    if (url.endsWith('/markdown') && ++writes === 1) {
      return { ok: false, status: 400, json: async () => ({}) };
    }

    return { ok: true, json: async () => ({ id }) };
  };
  await popup.click('#convert');
  await popup.click('#notion-save');
  assert.equal(popup.element('#notion-save').disabled, false);
  assert.equal(popup.element('#notion-link').hidden, false);
  await popup.click('#notion-save');
  assert.equal(requests.filter((r) => r.url.endsWith('/pages')).length, 1);
  assert.equal(
    requests[0].body.properties.title.title[0].text.content,
    'Original page title | Website'
  );
  assert.equal(writes, 2);
  assert.ok(requests[2].body.replace_content.new_str.includes('Example text'));
  assert.equal(popup.element('#notion-save').disabled, true);
  assert.equal(popup.element('#notion-message').textContent, popup.translate('notionSaved'));
  await popup.click('#settings-open');
  assert.equal(popup.state.optionsOpened, true);
  assert.equal(popup.element('#notion-token'), null);
});

for (const locale of ['en', 'ru']) {
  test(`popup: conversion, copying, ZIP and localization (${locale})`, async (t) => {
    const popup = await openPopup(t, { locale });
    assert.equal(popup.window.document.documentElement.lang, locale);
    assert.equal(popup.element('#status').textContent, popup.translate('conversionAvailable'));
    assert.equal(
      popup.element('#text-count').textContent,
      popup.translate('characterCount', (1234).toLocaleString(locale))
    );
    await popup.click('#convert');
    assert.equal(popup.element('#output').hidden, false);
    assert.equal(popup.element('#convert').hidden, true);
    await popup.click('#copy');
    assert.equal(popup.state.copied, popup.element('#preview').value);
    await popup.click('#download');
    assert.equal(popup.state.downloads[0].filename, 'Article.zip');
    const files = unzipSync(new Uint8Array(await popup.state.blob.arrayBuffer()));
    assert.ok(strFromU8(files['Article.md']).includes('Example text'));
    assert.equal(popup.element('#download').disabled, false);
    assert.equal(popup.state.timers[0].delay, 30000);
    popup.state.timers[0].callback();
    assert.deepEqual(popup.state.revoked, ['blob:archive']);
  });
}

const analysisCases: [string, Record<string, any>, string][] = [
  ['no tab', { tabs: [] }, 'noActiveTab'],
  ['missing tab id', { tabs: [{}] }, 'noActiveTab'],
  ...[
    'chrome://extensions',
    'file:///page.html',
    'https://chromewebstore.google.com/detail/example',
    'https://chrome.google.com/webstore/detail/example',
  ].map((url): [string, Record<string, any>, string] => [
    url,
    { tabs: [{ id: 7, url }] },
    'restrictedPage',
  ]),
  ['missing URL', { tabs: [{ id: 7 }] }, 'restrictedPage'],
  ['invalid URL', { tabs: [{ id: 7, url: 'not a URL' }] }, 'accessError'],
  ['injection error', { analysisError: true }, 'accessError'],
  ['empty response', { analysisResponse: [] }, 'accessError'],
  ['missing result', { analysisResponse: [{}] }, 'accessError'],
  ['unsupported document', { article: { supported: false } }, 'unsupportedDocument'],
  ['no article', { article: { articleFound: false } }, 'articleNotFound'],
];

for (const [name, options, message] of analysisCases) {
  test(`popup analysis: ${name}`, async (t) => {
    const popup = await openPopup(t, options);
    assert.equal(popup.element('#message').textContent, popup.translate(message));
    assert.equal(popup.element('#convert').hidden, true);
    assert.equal(popup.element('main').getAttribute('aria-busy'), 'false');
  });
}

for (const tabTitle of ['Tab title', undefined]) {
  test(`popup uses fallback title: ${tabTitle ?? 'untitled'}`, async (t) => {
    const popup = await openPopup(t, { article: { title: '' }, tabTitle });
    assert.equal(popup.element('#page-title').textContent, tabTitle ?? popup.translate('untitled'));
    await popup.click('#convert');
    assert.ok(
      popup.element('#preview').value.startsWith(`# ${tabTitle ?? popup.translate('untitled')}`)
    );
  });
}

test('popup reports conversion and clipboard failures', async (t) => {
  const popup = await openPopup(t, { article: { content: '' }, copyError: true });
  await popup.click('#convert');
  assert.equal(popup.element('#action-message').textContent, popup.translate('conversionError'));
  assert.equal(popup.element('#output').hidden, true);
  await popup.click('#copy');
  assert.equal(popup.element('#action-message').textContent, popup.translate('copyError'));
  await popup.click('#download');
  assert.equal(popup.element('#action-message').textContent, popup.translate('downloadError'));
  assert.equal(popup.state.timers.length, 0);
});

for (const [name, options, missing] of [
  ['success', {}, false],
  [
    'missing image',
    { imageResponse: [{ result: [{ url: 'https://example.com/image.png', failed: true }] }] },
    true,
  ],
  ['closed tab', { imageError: true }, true],
  ['no response', { imageResponse: [] }, true],
  ['no result', { imageResponse: [{}] }, true],
] as [string, Record<string, any>, boolean][]) {
  test(`popup ZIP with images: ${name}`, async (t) => {
    const popup = await openPopup(t, {
      article: { content: '<p>Text</p><img src="/image.png" alt="Image">' },
      ...options,
    });
    await popup.click('#convert');
    popup.element('#download').click();
    assert.equal(popup.element('#download').disabled, true);
    assert.equal(popup.element('#action-message').textContent, popup.translate('preparingArchive'));
    await flush();
    const files = unzipSync(new Uint8Array(await popup.state.blob.arrayBuffer()));
    const md = strFromU8(files['Article.md']);
    assert.ok(md.includes(missing ? 'https://example.com/image.png' : 'images/image-1.png'));
    assert.equal(
      popup.element('#action-message').textContent,
      popup.translate(missing ? 'archiveMissingImages' : 'downloadStarted', '1')
    );
    assert.equal(popup.element('#download').disabled, false);
  });
}

test('popup restores the download button and releases URL after download rejection', async (t) => {
  const popup = await openPopup(t, { downloadError: true });
  await popup.click('#convert');
  await popup.click('#download');
  assert.equal(popup.element('#action-message').textContent, popup.translate('downloadError'));
  assert.equal(popup.element('#download').disabled, false);
  popup.state.timers[0].callback();
  assert.deepEqual(popup.state.revoked, ['blob:archive']);
});

test('Notion without a session token prompts settings and makes no requests', async (t) => {
  const popup = await openPopup(t);
  popup.state.fetcher = () => {
    assert.fail('Unexpected API call');
  };
  await popup.click('#convert');
  await popup.click('#notion-save');
  assert.equal(
    popup.element('#notion-message').textContent,
    popup.translate('notionNeedsSettings')
  );
});

for (const locale of ['en', 'ru']) {
  test(`Notion image errors are localized and source tab receives no token (${locale})`, async (t) => {
    const id = '123456781234123412341234567890ab';
    const url = 'https://example.com/missing.png';
    const popup = await openPopup(t, {
      locale,
      notion: { token: 'private-token', parentId: id },
      article: { content: `<p>Text</p><img src="${url}">` },
      imageResponse: [{ result: [{ url, failed: true, reason: 'http', status: 404 }] }],
    });
    let marker;
    let errorText;
    popup.state.fetcher = async (request, options) => {
      const body = options.body ? JSON.parse(options.body) : undefined;
      let result = {};

      if (request.endsWith('/pages')) {
        result = { id };
      } else if (request.endsWith('/markdown')) {
        marker = body.replace_content.new_str.match(/H2MDIMAGE[a-zA-Z0-9]+END/)[0];
      } else if (options.method === 'GET') {
        result = {
          results: [
            {
              id: 'marker',
              type: 'paragraph',
              paragraph: { rich_text: [{ text: { content: marker } }] },
            },
          ],
        };
      } else {
        errorText = body.paragraph.rich_text[0];
      }

      return { ok: true, json: async () => result };
    };
    await popup.click('#convert');
    await popup.click('#notion-save');
    assert.equal(popup.element('#notion-save').disabled, true);
    assert.equal(
      popup.element('#notion-message').textContent,
      popup.translate('notionSavedImageErrors', '1')
    );
    assert.equal(errorText.annotations.bold, true);
    assert.ok(errorText.text.content.includes('404'));
    assert.deepEqual(popup.state.imageRequest.args, [[url], 50 * 1024 * 1024]);
    assert.ok(!JSON.stringify(popup.state.imageRequest).includes('private-token'));
  });
}
