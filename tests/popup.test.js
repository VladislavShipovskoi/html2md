import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { unzipSync, strFromU8 } from 'fflate';
import { initializePopup } from '../extension/popup.js';

const html = await readFile(new URL('../extension/popup.html', import.meta.url), 'utf8');
const flush = () => new Promise((resolve) => setImmediate(resolve));

async function openPopup(t, options = {}) {
  const { window } = new JSDOM(html);
  const locale = options.locale ?? 'en';
  const messages = JSON.parse(
    await readFile(
      new URL(`../extension/_locales/${locale}/messages.json`, import.meta.url),
      'utf8'
    )
  );
  const translate = (key, value) => {
    if (key === '@@ui_locale') {
      return locale;
    }

    assert.ok(messages[key], `Missing translation: ${key}`);
    return messages[key].message.replace('$COUNT$', value ?? '');
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
  const state = { downloads: [], revoked: [], timers: [], copied: null, blob: null };
  const chrome = {
    i18n: { getMessage: translate },
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

        if (options.imageError) {
          throw new Error('Tab closed');
        }

        return (
          options.imageResponse ?? [
            {
              result: [
                { url: 'https://example.com/image.png', type: 'image/png', bytes: [1, 2, 3] },
              ],
            },
          ]
        );
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
  const values = {
    document: window.document,
    chrome,
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
  };
  const descriptors = new Map(
    Object.keys(values).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );

  for (const [key, value] of Object.entries(values)) {
    Object.defineProperty(globalThis, key, { configurable: true, value });
  }

  t.after(() => {
    window.close();

    for (const [key, descriptor] of descriptors) {
      if (descriptor) {
        Object.defineProperty(globalThis, key, descriptor);
      } else {
        delete globalThis[key];
      }
    }
  });
  t.mock.method(URL, 'createObjectURL', (blob) => {
    state.blob = blob;
    return 'blob:archive';
  });
  t.mock.method(URL, 'revokeObjectURL', (url) => state.revoked.push(url));
  t.mock.method(globalThis, 'setTimeout', (callback, delay) => {
    state.timers.push({ callback, delay });
    return 1;
  });
  await initializePopup();
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

const analysisCases = [
  ['no tab', { tabs: [] }, 'noActiveTab'],
  ['missing tab id', { tabs: [{}] }, 'noActiveTab'],
  ...[
    'chrome://extensions',
    'file:///page.html',
    'https://chromewebstore.google.com/detail/example',
    'https://chrome.google.com/webstore/detail/example',
  ].map((url) => [url, { tabs: [{ id: 7, url }] }, 'restrictedPage']),
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
]) {
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
