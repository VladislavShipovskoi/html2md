import type { RuntimeEnvironment } from '../browser/types.ts';
import { createBrowserAdapter } from '../browser/chrome.ts';
import { createIntegrationClient } from '../integrations/commands.ts';
import { createNotionClient } from '../browser/notion-client.ts';

export function createRuntimeServices(environment: RuntimeEnvironment) {
  const { chrome, navigator, document, crypto, URL, Blob, setTimeout } = environment;
  const createId = () => crypto.randomUUID();
  return {
    document,
    i18n: chrome.i18n,
    themeStorage: chrome.storage,
    createId,
    repository: createIntegrationClient(chrome.runtime),
    browser: createBrowserAdapter({
      chrome,
      clipboard: navigator.clipboard,
      URL,
      Blob,
      setTimeout,
    }),
    notionApi: (integrationId: string) => createNotionClient(chrome.runtime, integrationId),
  };
}
