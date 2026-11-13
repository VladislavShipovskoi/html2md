import type { RuntimeEnvironment } from '../browser/types.ts';
import { createBrowserAdapter } from '../browser/chrome.ts';
import { createIntegrationRepository } from '../integrations/integrations.ts';
import { createNotionApi } from '../../core/notion/index.ts';

export function createRuntimeServices(environment: RuntimeEnvironment) {
  const { chrome, navigator, document, crypto, URL, Blob, setTimeout, fetch } = environment;
  const createId = () => crypto.randomUUID();
  return {
    document,
    i18n: chrome.i18n,
    themeStorage: chrome.storage,
    createId,
    repository: createIntegrationRepository({
      storage: chrome.storage,
      locks: navigator.locks,
      createId,
    }),
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
