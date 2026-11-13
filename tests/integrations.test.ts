import { test } from 'node:test';
import { mockStorage } from './storage-helper.ts';
import assert from 'node:assert/strict';
import { createIntegrationRepository } from '../extension/integrations/integrations.ts';
const parentId = '123456781234123412341234567890ab';
test('multiple integrations isolate secrets and delete only the selected record', async () => {
  const { storage, data, locks } = mockStorage();
  const repository = createIntegrationRepository({
    storage,
    locks,
    createId: () => crypto.randomUUID(),
  });
  await repository.initialize();
  const first = await repository.save({ name: 'First', parentId, token: 'token-one' });
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
