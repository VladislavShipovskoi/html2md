import { createBrowserAdapter } from '../browser/chrome.js';
import { createIntegrationRepository } from '../integrations/integrations.js';
import { createNotionApi } from '../../core/notion/index.js';

export function createRuntimeServices(environment) {
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
    notionApi: (token) =>
      createNotionApi({
        token,
        fetcher: fetch,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      }),
  };
}
