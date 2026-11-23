import { createIntegrationRepository } from '../extension/integrations/integrations.ts';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { initializeOptions } from '../extension/options/options.ts';
import { mockStorage } from './storage-helper.ts';

const locale = 'en';
const html = await readFile(new URL('../extension/options/options.html', import.meta.url), 'utf8');
const parentId = '123456781234123412341234567890ab';
const flush = () => new Promise((resolve) => setImmediate(resolve));

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
  assert.equal(reopened.window.document.querySelector<HTMLInputElement>('#notion-token').value, '');
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

test('remember and forget token without losing form edits (' + locale + ')', async (t) => {
  const { window } = new JSDOM(html, { url: 'https://extension.test/options.html#new' });
  t.after(() => window.close());
  const fixture = mockStorage();
  const repository = createIntegrationRepository({ ...fixture, createId: () => 'saved' });
  const messages = JSON.parse(
    await readFile(
      new URL('../extension/_locales/' + locale + '/messages.json', import.meta.url),
      'utf8'
    )
  );
  await initializeOptions({
    document: window.document,
    repository,
    i18n: {
      getMessage: (key) => (key === '@@ui_locale' ? locale : (messages[key]?.message ?? key)),
    },
  });
  const get = (id) => window.document.getElementById(id) as HTMLInputElement;
  assert.equal(get('remember-token').checked, false);
  assert.equal(get('forget-token').hidden, true);
  get('integration-name').value = 'Saved';
  get('notion-parent').value = parentId;
  get('notion-token').value = 'secret';
  get('remember-token').checked = true;
  get('settings-form').dispatchEvent(new window.Event('submit', { cancelable: true }));
  await flush();
  assert.equal(fixture.data.local['integrationToken:saved'], 'secret');
  assert.equal(get('remember-token').checked, true);
  assert.equal(get('notion-token').value, '');
  assert.equal(get('forget-token').hidden, false);
  get('integration-name').value = 'Unsaved name';
  get('notion-parent').value = 'Unsaved parent';
  get('remember-token').checked = false;
  get('notion-token').value = 'Unsaved replacement';
  get('forget-token').click();
  await flush();
  assert.equal(get('integration-name').value, 'Unsaved name');
  assert.equal(get('notion-parent').value, 'Unsaved parent');
  assert.equal(get('remember-token').checked, false);
  assert.equal(get('notion-token').value, '');
  assert.equal(get('forget-token').hidden, true);
  assert.equal(get('connection-status').textContent, messages.notionDisconnected.message);
  assert.equal((await repository.list())[0].name, 'Saved');
  assert.equal((await repository.list())[0].rememberToken, true);
  assert.equal((await repository.list())[0].connected, false);
  assert.equal(fixture.data.local['integrationToken:saved'], undefined);
});
