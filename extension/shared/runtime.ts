import type { RuntimeEnvironment } from '../browser/types.ts';
import { createBrowserAdapter } from '../browser/chrome.ts';
import { createIntegrationClient } from '../integrations/commands.ts';
import { createQueueClient } from '../queue/commands.ts';
import { watchActiveSource } from '../browser/active-source.ts';

export function createRuntimeServices(environment: RuntimeEnvironment) {
  const { chrome, navigator, document, crypto, URL, Blob, setTimeout } = environment;
  const createId = () => crypto.randomUUID();
  return {
    document,
    i18n: chrome.i18n,
    themeStorage: chrome.storage,
    sitePermissions: chrome.permissions,
    createId,
    repository: createIntegrationClient(chrome.runtime),
    browser: createBrowserAdapter({
      chrome,
      clipboard: navigator.clipboard,
      URL,
      Blob,
      setTimeout,
    }),
    queue: createQueueClient(chrome.runtime),
    watchSource: (onChange: (state: 'loading' | 'ready') => void) =>
      watchActiveSource(chrome, onChange),
  };
}
