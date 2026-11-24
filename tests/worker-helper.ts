import { createIntegrationRepository } from '../extension/integrations/integrations.ts';
import { createIntegrationHandler } from '../extension/background/integration-handler.ts';
import { createNotionHandler } from '../extension/background/notion-handler.ts';
import type { NotionFetcher } from '../core/notion/types.ts';
import type { IntegrationStorage, Locks } from '../extension/shared/types.ts';

export function mockWorker({
  storage,
  locks,
  fetcher,
}: {
  storage: IntegrationStorage;
  locks: Locks;
  fetcher: NotionFetcher;
}) {
  const repository = createIntegrationRepository({
    storage,
    locks,
    createId: () => crypto.randomUUID(),
  });
  const runtime = { id: 'test', getURL: (path: string) => `chrome-extension://test/${path}` };
  const listeners = [
    createIntegrationHandler(repository, runtime),
    createNotionHandler({ repository, runtime, fetcher, sleep: async () => {} }),
  ];
  const requests: unknown[] = [];
  const responses: unknown[] = [];
  const sender = (page = 'side-panel.html'): chrome.runtime.MessageSender => ({
    id: runtime.id,
    url: runtime.getURL(page),
  });
  function sendMessage(message: unknown, from = sender()): Promise<any> {
    const serialized = JSON.parse(JSON.stringify(message));
    requests.push(serialized);
    return new Promise((resolve, reject) => {
      for (const listener of listeners) {
        const waiting = listener(serialized, from, (response) => {
          const result = JSON.parse(JSON.stringify(response));
          responses.push(result);
          resolve(result);
        });

        if (waiting) {
          return;
        }
      }

      reject(new Error('No handler'));
    });
  }
  return { sendMessage, requests, responses, sender, repository };
}
