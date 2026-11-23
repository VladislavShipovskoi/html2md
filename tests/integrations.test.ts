import { test } from 'node:test';
import { mockStorage } from './storage-helper.ts';
import assert from 'node:assert/strict';
import { createIntegrationRepository } from '../extension/integrations/integrations.ts';
const make = (fixture) =>
  createIntegrationRepository({ ...fixture, createId: () => crypto.randomUUID() });
const parentId = '123456781234123412341234567890ab';
test('multiple integrations isolate secrets and delete only the selected record', async () => {
  const { storage, data, locks } = mockStorage();
  const repository = createIntegrationRepository({
    storage,
    locks,
    createId: () => crypto.randomUUID(),
  });
  await repository.initialize();
  const first = await repository.save({ name: 'First', parentId, token: ' Bearer token-one\r\n ' });
  const second = await repository.save({ name: 'Second', parentId, token: 'token-two' });
  assert.equal((await repository.list()).length, 2);
  assert.equal((await repository.connection(second)).token, 'token-two');
  await repository.save({ id: first, name: 'Renamed', parentId, token: '' });
  assert.equal((await repository.connection(first)).token, 'token-one');
  assert.ok(!JSON.stringify(data.local).includes('token-one'));
  await repository.remove(first);
  assert.equal(data.session[`integrationToken:${first}`], undefined);
  assert.equal((await repository.list())[0].id, second);
  delete data.session[`integrationToken:${second}`];
  assert.equal((await repository.list())[0].connected, false);
  await repository.save({ id: second, name: 'After restart', parentId, token: '' });
  await repository.remove(second);
  assert.deepEqual(await repository.list(), []);
});
test('migrates old connection and does not recreate it after deletion', async () => {
  const { storage, data, locks } = mockStorage(
    { notionParentId: parentId },
    { notionToken: 'old-secret' }
  );
  const repository = createIntegrationRepository({
    storage,
    locks,
    createId: () => crypto.randomUUID(),
  });
  await repository.initialize();
  const [record] = await repository.list();
  assert.equal(record.id, 'legacy-notion');
  assert.equal(record.connected, true);
  assert.equal(data.local.notionParentId, undefined);
  assert.equal(data.session.notionToken, undefined);
  await repository.remove(record.id);
  assert.deepEqual(await repository.list(), []);
});

for (const rememberToken of [false, true]) {
  test('token storage lifecycle: remember=' + rememberToken, async () => {
    const fixture = mockStorage();
    const repository = make(fixture);
    await repository.initialize();
    assert.equal(fixture.storage.local.accessLevel, 'TRUSTED_CONTEXTS');
    assert.equal(fixture.storage.session.accessLevel, 'TRUSTED_CONTEXTS');
    const id = await repository.save({ name: 'Saved', parentId, token: 'secret', rememberToken });
    const key = 'integrationToken:' + id;
    assert.equal(fixture.data[rememberToken ? 'local' : 'session'][key], 'secret');
    assert.equal(fixture.data[rememberToken ? 'session' : 'local'][key], undefined);
    assert.equal((await repository.list())[0].rememberToken, rememberToken);
    assert.ok(!JSON.stringify(await repository.list()).includes('secret'));
    await repository.save({ id, name: 'Renamed', parentId, token: '' });
    assert.equal((await repository.connection(id)).token, 'secret');
    await repository.save({
      id,
      name: 'Renamed',
      parentId,
      token: '',
      rememberToken: !rememberToken,
    });
    assert.equal(fixture.data[rememberToken ? 'session' : 'local'][key], 'secret');
    assert.equal(fixture.data[rememberToken ? 'local' : 'session'][key], undefined);
    await repository.forgetToken(id);
    assert.equal(fixture.data.local[key], undefined);
    assert.equal(fixture.data.session[key], undefined);
    assert.equal((await repository.list())[0].connected, false);
    assert.equal((await repository.list())[0].rememberToken, !rememberToken);
    await repository.save({ id, name: 'Renamed', parentId, token: 'replacement' });
    await repository.remove(id);
    assert.deepEqual(fixture.data.local, { integrations: [] });
    assert.deepEqual(fixture.data.session, {});
  });
}

test('persistent tokens survive a browser session reset; session tokens do not', async () => {
  const fixture = mockStorage();
  const repository = make(fixture);
  await repository.initialize();
  const persistent = await repository.save({
    name: 'Persistent',
    parentId,
    token: 'saved',
    rememberToken: true,
  });
  const temporary = await repository.save({ name: 'Temporary', parentId, token: 'temporary' });

  for (const key of Object.keys(fixture.data.session)) {
    delete fixture.data.session[key];
  }

  const restarted = make(fixture);
  await restarted.initialize();
  assert.equal((await restarted.connection(persistent)).token, 'saved');
  assert.equal((await restarted.connection(temporary)).token, '');
});

test('failed mode switch restores secrets and metadata', async () => {
  const fixture = mockStorage();
  const repository = make(fixture);
  await repository.initialize();
  const id = await repository.save({ name: 'Saved', parentId, token: 'secret' });
  const before = structuredClone(fixture.data);
  const write = fixture.storage.local.set;
  fixture.storage.local.set = async (values) => {
    if ('integrations' in values) {
      throw new Error('private failure');
    }

    await write(values);
  };
  await assert.rejects(
    repository.save({ id, name: 'Changed', parentId, token: '', rememberToken: true }),
    /notionSettingsError/
  );
  assert.deepEqual(fixture.data, before);
});

test('failed forgetting restores both token copies', async () => {
  const fixture = mockStorage();
  const repository = make(fixture);
  await repository.initialize();
  const id = await repository.save({
    name: 'Saved',
    parentId,
    token: 'secret',
    rememberToken: true,
  });
  const remove = fixture.storage.session.remove;
  let fail = true;
  fixture.storage.session.remove = async (key) => {
    if (fail) {
      fail = false;
      throw new Error('failure');
    }

    await remove(key);
  };
  await assert.rejects(repository.forgetToken(id), /notionSettingsError/);
  assert.equal((await repository.connection(id)).token, 'secret');
  assert.equal((await repository.list())[0].connected, true);
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
