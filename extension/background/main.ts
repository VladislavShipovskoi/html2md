import { createIntegrationRepository } from '../integrations/integrations.ts';
import { createIntegrationHandler } from './integration-handler.ts';
import { createNotionHandler } from './notion-handler.ts';

const repository = createIntegrationRepository({
  storage: chrome.storage,
  locks: navigator.locks,
  createId: () => crypto.randomUUID(),
});

chrome.runtime.onMessage.addListener(createIntegrationHandler(repository, chrome.runtime));
chrome.runtime.onMessage.addListener(
  createNotionHandler({
    repository,
    runtime: chrome.runtime,
    fetcher: fetch,
    sleep: (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
  })
);

function restrictStorageAccess() {
  void Promise.all([
    chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' }),
  ]).catch(() => {
    console.error('Could not restrict extension storage access.');
  });
}

chrome.runtime.onInstalled.addListener(restrictStorageAccess);
chrome.runtime.onStartup.addListener(restrictStorageAccess);
restrictStorageAccess();
