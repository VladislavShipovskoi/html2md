import { errorDetails, failure } from '../../core/errors.ts';
import type { TaskRepository } from '../queue/repository.ts';
import type { createIntegrationRepository } from '../integrations/integrations.ts';
import { QUEUE_CHANNEL, queueErrorCodes } from '../queue/commands.ts';
import type { EnqueueRequest, QueueResponse } from '../queue/commands.ts';

function validInput(value: unknown): value is EnqueueRequest {
  const input = value as EnqueueRequest | undefined;
  const snapshot = input?.snapshot;
  return Boolean(
    input &&
    ['archive', 'notion'].includes(input.type) &&
    typeof input.commandId === 'string' &&
    input.commandId &&
    snapshot &&
    typeof snapshot.title === 'string' &&
    Number.isInteger(snapshot.tabId) &&
    snapshot.tabId >= 0 &&
    typeof snapshot.documentId === 'string' &&
    snapshot.documentId &&
    ['en', 'ru'].includes(snapshot.locale) &&
    snapshot.options &&
    typeof snapshot.options.sourceLabel === 'string' &&
    snapshot.article &&
    ['title', 'content', 'url', 'baseUrl'].every(
      (key) => typeof (snapshot.article as any)[key] === 'string'
    ) &&
    (input.type !== 'notion' || typeof input.integrationId === 'string')
  );
}
export function createQueueHandler({
  tasks,
  integrations,
  runtime,
  wake,
  publish,
}: {
  tasks: TaskRepository;
  integrations: ReturnType<typeof createIntegrationRepository>;
  runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'>;
  wake(): void;
  publish(): Promise<void>;
}) {
  async function execute(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
    const url = sender.url?.split(/[?#]/)[0];

    if (sender.id !== runtime.id) {
      throw failure('queueInvalidTask');
    }

    if (url === runtime.getURL('offscreen.html') && message.type === 'wake') {
      wake();
      return;
    }

    if (url !== runtime.getURL('side-panel.html')) {
      throw failure('queueInvalidTask');
    }

    if (message.type === 'list') {
      return tasks.list();
    }

    if (message.type === 'enqueue') {
      if (!validInput(message.input)) {
        throw failure('queueInvalidTask');
      }

      const input = message.input;

      if (input.type === 'notion') {
        await integrations.initialize();
      }

      const destination =
        input.type === 'notion'
          ? (await integrations.list()).find((item) => item.id === input.integrationId)
          : undefined;

      if (input.type === 'notion' && !destination) {
        throw failure('integrationNotFound');
      }

      const id = await tasks.enqueue(
        input.type === 'archive'
          ? { type: 'archive', commandId: input.commandId, snapshot: input.snapshot }
          : {
              type: 'notion',
              commandId: input.commandId,
              snapshot: input.snapshot,
              integration: {
                id: destination!.id,
                name: destination!.name,
                parentId: destination!.parentId,
              },
            }
      );
      wake();
      await publish();
      return id;
    }

    if (message.type === 'clear') {
      await tasks.clearCompleted();
    } else if (typeof message.id === 'string' && message.type === 'retry') {
      await tasks.retry(message.id);
      wake();
    } else if (typeof message.id === 'string' && message.type === 'remove') {
      await tasks.remove(message.id);
    } else {
      throw failure('queueInvalidTask');
    }

    await publish();
  }
  return (
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: QueueResponse) => void
  ): true | undefined => {
    if (!message || typeof message !== 'object' || (message as any).channel !== QUEUE_CHANNEL) {
      return;
    }

    void execute(message as Record<string, unknown>, sender).then(
      (value) => respond({ ok: true, value }),
      (caught) => {
        const code = errorDetails(caught).code;
        respond({
          ok: false,
          code: queueErrorCodes.find((known) => known === code) ?? 'queueStorageError',
        });
      }
    );
    return true;
  };
}
