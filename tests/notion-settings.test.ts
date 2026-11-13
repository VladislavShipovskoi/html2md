import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIntegrationRepository } from '../extension/integrations/integrations.ts';
import { normalizeToken } from '../core/notion/index.ts';
import { mockStorage } from './storage-helper.ts';
const parentId = '123456781234123412341234567890ab';
const make = (fixture) =>
  createIntegrationRepository({ ...fixture, createId: () => crypto.randomUUID() });

test('normalizes pasted tokens and never persists them locally', async () => {
  for (const token of ['  ntn_example\r\n', 'Bearer ntn_example', 'ntn_exam\nple']) {
    assert.equal(normalizeToken(token), 'ntn_example');
    const fixture = mockStorage();
    const repository = make(fixture);
    await repository.initialize();
    const id = await repository.save({ name: 'Notion', token, parentId });
    assert.equal(fixture.data.session[`integrationToken:${id}`], 'ntn_example');
    assert.ok(!JSON.stringify(fixture.data.local).includes('ntn_example'));
  }
});
test('two repositories serialize concurrent creates, edits and deletion', async () => {
  const fixture = mockStorage();
  const first = make(fixture);
  const second = make(fixture);
  await Promise.all([first.initialize(), second.initialize()]);
  const [a, b] = await Promise.all([
    first.save({ name: 'First', token: 'one', parentId }),
    second.save({ name: 'Second', token: 'two', parentId }),
  ]);
  assert.equal((await first.list()).length, 2);
  await Promise.all([
    first.save({ id: a, name: 'First edited', token: '', parentId }),
    second.save({ id: b, name: 'Second edited', token: '', parentId }),
  ]);
  assert.deepEqual(
    (await first.list()).map((item) => item.name),
    ['First edited', 'Second edited']
  );
  await Promise.all([
    first.remove(a),
    second.save({ id: b, name: 'Survivor', token: '', parentId }),
  ]);
  assert.deepEqual(
    (await first.list()).map((item) => item.name),
    ['Survivor']
  );
  assert.equal((await second.connection(b)).token, 'two');
  assert.equal(fixture.data.session[`integrationToken:${a}`], undefined);
});
test('reads after initialization perform no writes or cleanup', async () => {
  const fixture = mockStorage();
  const repository = make(fixture);
  await repository.initialize();
  const id = await repository.save({ name: 'Notion', token: 'secret', parentId });

  for (const area of ['local', 'session']) {
    for (const operation of ['set', 'remove', 'setAccessLevel']) {
      fixture.storage[area][operation] = async () => assert.fail('Unexpected write during read');
    }
  }

  await repository.list();
  await repository.connection(id);
  await repository.initialize();
});
test('migration retries after a failed write without losing legacy data', async () => {
  const fixture = mockStorage({ notion: { token: 'legacy-secret', parentId } });
  const repository = make(fixture);
  const original = fixture.storage.local.set;
  fixture.storage.local.set = async () => {
    throw new Error('legacy-secret');
  };
  await assert.rejects(repository.initialize(), /^Error: notionSettingsError$/);
  assert.equal(fixture.data.local.notion.token, 'legacy-secret');
  fixture.storage.local.set = original;
  await repository.initialize();
  assert.equal((await repository.connection('legacy-notion')).token, 'legacy-secret');
  assert.equal(fixture.data.local.notion, undefined);
  assert.equal(fixture.storage.local.accessLevel, 'TRUSTED_CONTEXTS');
  assert.equal(fixture.storage.session.accessLevel, 'TRUSTED_CONTEXTS');
});
test('migration cleanup can retry and never resurrects a deleted integration', async () => {
  const fixture = mockStorage({ notion: { token: 'old', parentId } });
  const repository = make(fixture);
  const remove = fixture.storage.local.remove;
  fixture.storage.local.remove = async () => {
    throw new Error('cleanup failed');
  };
  await assert.rejects(repository.initialize(), /notionSettingsError/);
  assert.equal(fixture.data.local.integrations.length, 1);
  fixture.storage.local.remove = remove;
  await repository.initialize();
  await repository.remove('legacy-notion');
  const reopened = make(fixture);
  await reopened.initialize();
  assert.deepEqual(await reopened.list(), []);
});
test('failed saves roll back new and replaced session tokens; failed delete restores token', async () => {
  const fixture = mockStorage();
  const repository = make(fixture);
  await repository.initialize();
  const id = await repository.save({ name: 'Original', token: 'original', parentId });
  const original = fixture.storage.local.set;
  fixture.storage.local.set = async () => {
    throw new Error('secret in error');
  };
  await assert.rejects(
    repository.save({ name: 'New', token: 'new-secret', parentId }),
    /^Error: notionSettingsError$/
  );
  assert.deepEqual(fixture.data.session, { [`integrationToken:${id}`]: 'original' });
  await assert.rejects(
    repository.save({ id, name: 'Edited', token: 'replacement', parentId }),
    /notionSettingsError/
  );
  assert.equal((await repository.connection(id)).token, 'original');
  await assert.rejects(repository.remove(id), /notionSettingsError/);
  assert.equal((await repository.connection(id)).token, 'original');
  fixture.storage.local.set = original;
  await repository.remove(id);
  assert.deepEqual(await repository.list(), []);
});
test('missing cross-page locking fails explicitly instead of using an unsafe local fallback', async () => {
  const fixture = mockStorage();
  const repository = make({ ...fixture, locks: undefined });
  await assert.rejects(repository.initialize(), /notionSettingsError/);
  assert.deepEqual(fixture.data.local, {});
});

test('migration preserves newer parent and session token and retries a failed secret copy', async () => {
  const fixture = mockStorage(
    { notion: { token: 'old', parentId: 'older-parent' }, notionParentId: parentId },
    { notionToken: 'new' }
  );
  const repository = make(fixture);
  const write = fixture.storage.session.set;
  fixture.storage.session.set = async () => {
    throw new Error('old');
  };
  await assert.rejects(
    repository.initialize(),
    (error: Error & { code?: string; cause?: unknown }) =>
      error.code === 'notionSettingsError' && !error.cause
  );
  assert.equal(fixture.data.local.notion.token, 'old');
  assert.equal(fixture.data.local.integrations, undefined);
  fixture.storage.session.set = write;
  await repository.initialize();
  const record = await repository.connection('legacy-notion');
  assert.equal(record.parentId, parentId);
  assert.equal(record.token, 'new');
  assert.equal(fixture.data.local.notion, undefined);
});
