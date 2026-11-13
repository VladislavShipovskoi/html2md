import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeTheme } from '../extension/shared/theme.js';

const flush = () => new Promise((resolve) => setImmediate(resolve));
const t = (key) => key;

function page(context) {
  const dom = new JSDOM('<button id="theme-toggle"></button><p id="theme-message"></p>');
  context.after(() => dom.window.close());
  return dom.window.document;
}

test('theme persists, reopens and synchronizes between extension pages', async (context) => {
  const listeners = new Set();
  let data = {};
  const storage = {
    local: {
      async get(key) {
        assert.equal(key, 'theme');
        return data;
      },
      async set(value) {
        assert.deepEqual(Object.keys(value), ['theme']);
        data = value;

        for (const listener of listeners) {
          listener({ theme: { newValue: value.theme } }, 'local');
        }
      },
    },
    onChanged: {
      addListener: (listener) => listeners.add(listener),
      removeListener: (listener) => listeners.delete(listener),
    },
  };
  const popup = page(context);
  const options = page(context);
  await Promise.all([popup, options].map((document) => initializeTheme({ document, storage, t })));
  assert.equal(popup.documentElement.dataset.theme, 'light');
  popup.getElementById('theme-toggle').click();
  await flush();
  assert.equal(data.theme, 'dark');
  assert.equal(options.documentElement.dataset.theme, 'dark');
  assert.equal(options.getElementById('theme-toggle').getAttribute('aria-pressed'), 'true');
  assert.equal(options.getElementById('theme-toggle').title, 'switchToLightTheme');
  const reopened = page(context);
  await initializeTheme({ document: reopened, storage, t });
  assert.equal(reopened.documentElement.dataset.theme, 'dark');
  options.getElementById('theme-toggle').click();
  await flush();
  assert.equal(popup.documentElement.dataset.theme, 'light');
  popup.defaultView.dispatchEvent(new popup.defaultView.Event('pagehide'));
  assert.equal(listeners.size, 2);
});

test('theme storage failures keep the interface usable and allow retry', async (context) => {
  const document = page(context);
  let fail = true;
  const storage = {
    local: {
      async get() {
        throw new Error('unavailable');
      },
      async set() {
        if (fail) {
          throw new Error('unavailable');
        }
      },
    },
  };
  await initializeTheme({ document, storage, t });
  const button = document.getElementById('theme-toggle');
  button.click();
  await flush();
  assert.equal(button.disabled, false);
  assert.equal(document.documentElement.dataset.theme, 'light');
  assert.equal(document.getElementById('theme-message').textContent, 'themeSaveError');
  fail = false;
  button.click();
  await flush();
  assert.equal(document.documentElement.dataset.theme, 'dark');
  assert.equal(document.getElementById('theme-message').textContent, '');
});

test('a stale initial read cannot overwrite a newer theme change', async (context) => {
  const document = page(context);
  let finishRead;
  let listener;
  const storage = {
    local: {
      get: () =>
        new Promise((resolve) => {
          finishRead = resolve;
        }),
    },
    onChanged: {
      addListener: (fn) => {
        listener = fn;
      },
    },
  };
  const ready = initializeTheme({ document, storage, t });
  listener({ theme: { newValue: 'dark' } }, 'local');
  finishRead({ theme: 'light' });
  await ready;
  assert.equal(document.documentElement.dataset.theme, 'dark');
  listener({ theme: { newValue: 'unknown' } }, 'session');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  listener({ theme: { newValue: 'unknown' } }, 'local');
  assert.equal(document.documentElement.dataset.theme, 'light');
});
