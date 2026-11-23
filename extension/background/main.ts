import { createIntegrationRepository } from '../integrations/integrations.ts';
import { createIntegrationHandler } from './integration-handler.ts';

const repository = createIntegrationRepository({
  storage: chrome.storage,
  locks: navigator.locks,
  createId: () => crypto.randomUUID(),
});

chrome.runtime.onMessage.addListener(createIntegrationHandler(repository, chrome.runtime));

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
