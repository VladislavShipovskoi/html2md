export function mockStorage(localData = {}, sessionData = {}) {
  const data = { local: structuredClone(localData), session: structuredClone(sessionData) };
  const storage = {};

  for (const area of ['local', 'session']) {
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
export function mockLocks() {
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
