import { createIntegrationRepository } from '../extension/integrations/integrations.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeOptions } from '../extension/options/options.ts';
import { mockStorage } from './storage-helper.ts';

const html = await readFile(new URL('../extension/options/options.html', import.meta.url), 'utf8');
const parentId = '123456781234123412341234567890ab';
const flush = () => new Promise((resolve) => setImmediate(resolve));

for (const locale of ['en', 'ru']) {
  test(`integration table, details, editing and deletion (${locale})`, async (t) => {
    const { window } = new JSDOM(html, { url: 'https://extension.test/options.html#new' });
    const { storage, data, locks } = mockStorage();
    const messages = JSON.parse(
      await readFile(
        new URL(`../extension/_locales/${locale}/messages.json`, import.meta.url),
        'utf8'
      )
    );
    const repository = () =>
      createIntegrationRepository({ storage, locks, createId: () => crypto.randomUUID() });
    const i18n = {
      getMessage: (key) => {
        if (key === '@@ui_locale') {
          return locale;
        }

        assert.ok(messages[key], key);
        return messages[key].message;
      },
    };
    t.after(() => window.close());
    await initializeOptions({ document: window.document, i18n, repository: repository() });
    const get = (id) => window.document.querySelector(id);
    assert.equal(window.document.documentElement.lang, locale);
    get('#integration-name').value = 'My Notion';
    get('#notion-token').value = ' Bearer private-token ';
    get('#notion-parent').value = parentId;
    get('#settings-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    assert.equal(get('#notion-token').value, '');
    const id = data.local.integrations[0].id;
    assert.equal(data.local.integrations[0].name, 'My Notion');
    assert.equal(data.local.integrations[0].parentId, parentId);
    assert.ok(!JSON.stringify(data.local).includes('private-token'));
    assert.deepEqual(data.session, { [`integrationToken:${id}`]: 'private-token' });
    assert.equal(get('#connection-status').textContent, messages.notionConnected.message);
    get('#integration-name').value = 'Renamed';
    get('#settings-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
    await flush();
    assert.equal(data.local.integrations[0].name, 'Renamed');
    window.close();
    const reopened = new JSDOM(html, { url: 'https://extension.test/options.html' });
    t.after(() => reopened.window.close());
    await initializeOptions({ document: reopened.window.document, i18n, repository: repository() });
    assert.equal(
      reopened.window.document.querySelector<HTMLInputElement>('#notion-token').value,
      ''
    );
    assert.equal(reopened.window.document.querySelectorAll('tbody tr').length, 1);
    const row = reopened.window.document.querySelector<HTMLInputElement>('tbody tr');
    assert.equal(row.querySelector<HTMLInputElement>('a').textContent, 'Renamed');
    row.querySelector<HTMLInputElement>('button').click();
    await flush();
    assert.deepEqual(data.session, {});
    assert.deepEqual(data.local, { integrations: [] });
    assert.equal(reopened.window.location.hash, '');
    assert.equal(reopened.window.document.querySelectorAll('tbody tr').length, 0);
  });
}
