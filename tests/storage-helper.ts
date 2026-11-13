import type { IntegrationStorage, StorageData, Locks } from '../extension/shared/types.ts';

export function mockStorage(localData: StorageData = {}, sessionData: StorageData = {}) {
  const data = { local: structuredClone(localData), session: structuredClone(sessionData) };
  const storage = {} as IntegrationStorage & {
    local: { accessLevel?: string };
    session: { accessLevel?: string };
  };

  for (const area of ['local', 'session'] as const) {
    storage[area] = {
      accessLevel: undefined,
      async setAccessLevel({ accessLevel }) {
        this.accessLevel = accessLevel;
      },
      async get(keys) {
        const selected =
          keys == null ? Object.keys(data[area]) : Array.isArray(keys) ? keys : [keys];
        return structuredClone(
          Object.fromEntries(
            selected.filter((key) => key in data[area]).map((key) => [key, data[area][key]])
          )
        );
      },
      async set(values) {
        Object.assign(data[area], values);
      },
      async remove(key) {
        delete data[area][key];
      },
    };
  }

  return { storage, data, locks: mockLocks() };
}

// Test-only scheduler modeling the shared lock manager of one extension origin.
export function mockLocks(): Locks {
  const queues = new Map();
  return {
    request(name, action) {
      const next = (queues.get(name) ?? Promise.resolve()).then(action);
      queues.set(
        name,
        next.catch(() => {})
      );
      return next;
    },
  };
}
