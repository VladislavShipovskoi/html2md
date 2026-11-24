import { createIntegrationRepository } from '../integrations/integrations.ts';
import { createIntegrationHandler } from './integration-handler.ts';
import { createNotionHandler } from './notion-handler.ts';
import { createTaskRepository } from '../queue/repository.ts';
import { createQueueHandler } from './queue-handler.ts';
import { createExportExecutor } from './executor.ts';
import { createOffscreenBridge } from './offscreen.ts';
import { createTaskApi } from './task-api.ts';
import { createTaskTranslator } from '../shared/task-localization.ts';
import { downloadPageImages } from '../browser/download-images.ts';
import { registerSidePanel } from './panel.ts';

registerSidePanel(chrome);

const tasks = createTaskRepository();
const offscreen = createOffscreenBridge(chrome);

const repository = createIntegrationRepository({
  storage: chrome.storage,
  locks: navigator.locks,
  createId: () => crypto.randomUUID(),
});

let publishing = Promise.resolve();
function publish() {
  publishing = publishing
    .catch(() => {})
    .then(async () => {
      const snapshot = await tasks.list();
      await chrome.runtime
        .sendMessage({ channel: 'html2md-queue-update', tasks: snapshot })
        .catch(() => {});
    });
  return publishing;
}
const executor = createExportExecutor({
  tasks,
  offscreen,
  publish,
  downloads: chrome.downloads,
  translate: createTaskTranslator(chrome.runtime.getURL, fetch),
  connected: async (id) => {
    await repository.initialize();
    return Boolean((await repository.connection(id)).token);
  },
  api: (id) =>
    createTaskApi(
      repository,
      id,
      fetch,
      (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms))
    ),
  images: (snapshot, urls, progress) =>
    downloadPageImages(chrome.scripting, snapshot.tabId, urls, progress, snapshot.documentId),
  exclusive: (action) =>
    navigator.locks.request('html2md-export-executor', { ifAvailable: true }, async (lock) => {
      if (lock) {
        await action();
      }
    }),
});
const wake = () => {
  void executor.run().catch(() => {
    console.error('Could not process the export queue.');
  });
};
chrome.runtime.onMessage.addListener(
  createQueueHandler({ tasks, integrations: repository, runtime: chrome.runtime, wake, publish })
);
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'html2md-queue') {
    wake();
  }
});
chrome.downloads.onChanged.addListener(wake);
chrome.runtime.onStartup.addListener(wake);
chrome.runtime.onInstalled.addListener(wake);
chrome.storage.onChanged.addListener((changes) => {
  for (const [key, change] of Object.entries(changes)) {
    if (key.startsWith('integrationToken:') && change.newValue) {
      void executor
        .credentialsChanged(key.slice('integrationToken:'.length))
        .then(wake)
        .catch(() => {});
    }
  }

  if (changes.integrations) {
    wake();
  }
});
void chrome.alarms.create('html2md-queue', { periodInMinutes: 0.5 });
wake();

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
