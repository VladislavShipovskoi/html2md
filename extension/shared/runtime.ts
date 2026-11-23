import type { RuntimeEnvironment } from '../browser/types.ts';
import { createBrowserAdapter } from '../browser/chrome.ts';
import { createIntegrationClient } from '../integrations/commands.ts';
import { createNotionApi } from '../../core/notion/index.ts';
import { failure } from '../../core/errors.ts';
import type { Integration } from './types.ts';

export function createRuntimeServices(environment: RuntimeEnvironment) {
  const { chrome, navigator, document, crypto, URL, Blob, setTimeout, fetch } = environment;
  const createId = () => crypto.randomUUID();
  return {
    document,
    i18n: chrome.i18n,
    themeStorage: chrome.storage,
    createId,
    repository: createIntegrationClient(chrome.runtime),
    async notionConnection(id: string) {
      try {
        const { integrations = [] } = await chrome.storage.local.get('integrations');
        const record = (integrations as Integration[]).find((item) => item.id === id);

        if (!record) {
          throw failure('integrationNotFound');
        }

        const key = `integrationToken:${id}`;
        const values = await chrome.storage[record.rememberToken ? 'local' : 'session'].get(key);
        return { parentId: record.parentId, token: (values[key] ?? '') as string };
      } catch {
        throw failure('notionSettingsError');
      }
    },
    browser: createBrowserAdapter({
      chrome,
      clipboard: navigator.clipboard,
      URL,
      Blob,
      setTimeout,
    }),
    notionApi: (token: string) =>
      createNotionApi({
        token,
        fetcher: fetch,
        sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      }),
  };
}
