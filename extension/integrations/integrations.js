import { failure } from '../../core/index.js';
import { notionPageId, normalizeToken } from '../../core/notion/index.js';

const LOCK_NAME = 'html2md-integrations';
const tokenKey = (id) => `integrationToken:${id}`;
const persisted = ({ id, type, name, parentId }) => ({ id, type, name, parentId });

export function createIntegrationRepository({ storage, locks, createId }) {
  let initialization;
  let ready = false;
  async function safe(action) {
    try {
      return await action();
    } catch (error) {
      if (
        [
          'integrationNotFound',
          'integrationNameRequired',
          'notionInvalidParent',
          'notionMissingToken',
        ].includes(error.message)
      ) {
        throw error;
      }

      throw failure('notionSettingsError');
    }
  }

  const locked = (action) => safe(() => locks.request(LOCK_NAME, action));

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
    } catch (error) {
      initialization = undefined;
      throw error;
    }
  }

  async function records() {
    if (!ready) {
      throw failure('notionSettingsError');
    }

    return (await storage.local.get('integrations')).integrations ?? [];
  }

  async function list() {
    return locked(async () =>
      Promise.all(
        (await records()).map(async (record) => {
          const session = await storage.session.get(tokenKey(record.id));
          return { ...persisted(record), connected: Boolean(session[tokenKey(record.id)]) };
        })
      )
    );
  }

  async function connection(id) {
    return locked(async () => {
      const record = (await records()).find((item) => item.id === id);

      if (!record) {
        throw failure('integrationNotFound');
      }

      const session = await storage.session.get(tokenKey(id));
      return { ...persisted(record), token: session[tokenKey(id)] ?? '' };
    });
  }

  async function restoreToken(key, token) {
    if (token === undefined) {
      await storage.session.remove(key);
    } else {
      await storage.session.set({ [key]: token });
    }
  }

  async function save({ id, name, parentId, token }) {
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

      const record = { id: id ?? createId(), type: 'notion', name: name.trim(), parentId: parent };
      const key = tokenKey(record.id);
      const previous = (await storage.session.get(key))[key];
      const next = current.map(persisted);

      if (index < 0) {
        next.push(record);
      } else {
        next[index] = record;
      }

      if (normalized) {
        await storage.session.set({ [key]: normalized });
      }

      try {
        await storage.local.set({ integrations: next });
      } catch (error) {
        if (normalized) {
          await restoreToken(key, previous);
        }

        throw error;
      }
      return record.id;
    });
  }

  async function remove(id) {
    return locked(async () => {
      const current = await records();
      const key = tokenKey(id);
      const previous = (await storage.session.get(key))[key];
      await storage.session.remove(key);
      try {
        await storage.local.set({
          integrations: current.filter((item) => item.id !== id).map(persisted),
        });
      } catch (error) {
        await restoreToken(key, previous);
        throw error;
      }
    });
  }

  return { initialize, list, connection, save, remove };
}
