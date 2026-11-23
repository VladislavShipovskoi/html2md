import { errorDetails } from '../../core/errors.ts';
import type {
  Integration,
  IntegrationInput,
  IntegrationStorage,
  Locks,
  StorageArea,
} from '../shared/types.ts';
import { failure } from '../../core/index.ts';
import { notionPageId, normalizeToken } from '../../core/notion/index.ts';

const LOCK_NAME = 'html2md-integrations';
const tokenKey = (id: string) => `integrationToken:${id}`;
const persisted = ({ id, type, name, parentId, rememberToken }: Integration): Integration => ({
  id,
  type,
  name,
  parentId,
  rememberToken: rememberToken ?? false,
});

export function createIntegrationRepository({
  storage,
  locks,
  createId,
}: {
  storage: IntegrationStorage;
  locks: Locks;
  createId: () => string;
}) {
  let initialization: Promise<void> | undefined;
  let ready = false;
  async function safe<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (caught) {
      const error = errorDetails(caught);

      if (
        [
          'integrationNotFound',
          'integrationNameRequired',
          'notionInvalidParent',
          'notionMissingToken',
        ].includes(error.message ?? '')
      ) {
        throw error;
      }

      throw failure('notionSettingsError');
    }
  }

  const locked = <T>(action: () => Promise<T>) => safe(() => locks.request(LOCK_NAME, action));

  async function initialize() {
    initialization ??= locked(async () => {
      await Promise.all([
        storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
        storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
      ]);
      const local = await storage.local.get(['integrations', 'notion', 'notionParentId']);

      if (!local.integrations) {
        const session = await storage.session.get(['notionToken', tokenKey('legacy-notion')]);
        const token = session.notionToken || local.notion?.token;
        const parentId = local.notionParentId || local.notion?.parentId || '';

        if (token && !session[tokenKey('legacy-notion')]) {
          await storage.session.set({ [tokenKey('legacy-notion')]: token });
        }

        await storage.local.set({
          integrations:
            parentId || token
              ? [{ id: 'legacy-notion', type: 'notion', name: 'Notion', parentId }]
              : [],
        });
      }

      await storage.local.remove('notion');
      await storage.local.remove('notionParentId');
      await storage.session.remove('notionToken');
      ready = true;
    });
    try {
      await initialization;
    } catch (caught) {
      const error = errorDetails(caught);
      initialization = undefined;
      throw error;
    }
  }

  async function records(): Promise<Integration[]> {
    if (!ready) {
      throw failure('notionSettingsError');
    }

    return (await storage.local.get('integrations')).integrations ?? [];
  }

  const tokenStorage = (record?: Integration) =>
    storage[record?.rememberToken ? 'local' : 'session'];
  const readToken = async (record: Integration) =>
    (await tokenStorage(record).get(tokenKey(record.id)))[tokenKey(record.id)];
  const writeToken = (area: StorageArea, key: string, value: string | undefined) =>
    value === undefined ? area.remove(key) : area.set({ [key]: value });
  async function clearTokens(key: string) {
    await storage.local.remove(key);
    await storage.session.remove(key);
  }

  async function list() {
    return locked(async () =>
      Promise.all(
        (await records()).map(async (record) => ({
          ...persisted(record),
          connected: Boolean(await readToken(record)),
        }))
      )
    );
  }

  async function connection(id: string) {
    return locked(async () => {
      const record = (await records()).find((item) => item.id === id);

      if (!record) {
        throw failure('integrationNotFound');
      }

      return { ...persisted(record), token: (await readToken(record)) ?? '' };
    });
  }

  async function changeTokens(id: string, action: (key: string) => Promise<void>) {
    const key = tokenKey(id);
    const local = (await storage.local.get(key))[key];
    const session = (await storage.session.get(key))[key];
    try {
      await action(key);
    } catch (error) {
      const restored = await Promise.allSettled([
        writeToken(storage.local, key, local),
        writeToken(storage.session, key, session),
      ]);

      if (restored.some((result) => result.status === 'rejected')) {
        throw failure('notionSettingsError');
      }

      throw error;
    }
  }

  async function save({ id, name, parentId, token, rememberToken }: IntegrationInput) {
    return locked(async () => {
      const parent = notionPageId(parentId);

      if (!name.trim()) {
        throw failure('integrationNameRequired');
      }

      const current = await records();
      const index = current.findIndex((item) => item.id === id);

      if (id && index < 0) {
        throw failure('integrationNotFound');
      }

      const normalized = normalizeToken(token);

      if (!normalized && !id) {
        throw failure('notionMissingToken');
      }

      const previous = current[index];
      const record: Integration = {
        id: id ?? createId(),
        type: 'notion',
        name: name.trim(),
        parentId: parent,
        rememberToken: rememberToken ?? previous?.rememberToken ?? false,
      };
      const next = current.map(persisted);

      if (index < 0) {
        next.push(record);
      } else {
        next[index] = record;
      }

      await changeTokens(record.id, async (key) => {
        const value = normalized || (previous ? await readToken(previous) : undefined);
        await writeToken(tokenStorage(record), key, value);
        await storage[record.rememberToken ? 'session' : 'local'].remove(key);
        await storage.local.set({ integrations: next });
      });
      return record.id;
    });
  }

  async function forgetToken(id: string) {
    return locked(async () => {
      if (!(await records()).some((record) => record.id === id)) {
        throw failure('integrationNotFound');
      }

      await changeTokens(id, clearTokens);
    });
  }

  async function remove(id: string) {
    return locked(async () => {
      const current = await records();
      await changeTokens(id, async (key) => {
        await clearTokens(key);
        await storage.local.set({
          integrations: current.filter((item) => item.id !== id).map(persisted),
        });
      });
    });
  }

  return { initialize, list, connection, save, remove, forgetToken };
}
