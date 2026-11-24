import { failure } from '../../core/errors.ts';
import type { ArticleSnapshot, ExportTask } from './types.ts';

export const QUEUE_CHANNEL = 'html2md-queue';
export const queueErrorCodes = [
  'queueStorageError',
  'queueInvalidTask',
  'queueTaskNotFound',
  'queueTaskRunning',
  'queueStaleAttempt',
  'queueTaskNotRetryable',
  'queueTaskNotWaiting',
  'queueNeedsReview',
  'integrationNotFound',
  'notionMissingToken',
  'notionSettingsError',
] as const;
export interface EnqueueRequest {
  commandId: string;
  type: 'archive' | 'notion';
  snapshot: ArticleSnapshot;
  integrationId?: string;
}
export type QueueCommand = { channel: typeof QUEUE_CHANNEL } & (
  | { type: 'enqueue'; input: EnqueueRequest }
  | { type: 'list' | 'clear' | 'wake' }
  | { type: 'retry' | 'remove'; id: string }
);
export type QueueResponse = { ok: true; value?: unknown } | { ok: false; code: string };
export interface QueueTransport {
  id?: string;
  getURL?: (path: string) => string;
  sendMessage(message: QueueCommand): Promise<QueueResponse>;
  onMessage?: Pick<typeof chrome.runtime.onMessage, 'addListener' | 'removeListener'>;
}
export function createQueueClient(transport: QueueTransport) {
  async function request<T>(command: QueueCommand): Promise<T> {
    let response: QueueResponse;
    try {
      response = await transport.sendMessage(command);
    } catch {
      throw failure('queueStorageError');
    }

    if (response?.ok !== true) {
      const code =
        response?.ok === false
          ? queueErrorCodes.find((value) => value === response.code)
          : undefined;
      throw failure(code ?? 'queueStorageError');
    }

    return response.value as T;
  }
  return {
    enqueue: (input: EnqueueRequest) =>
      request<string>({ channel: QUEUE_CHANNEL, type: 'enqueue', input }),
    list: () => request<ExportTask[]>({ channel: QUEUE_CHANNEL, type: 'list' }),
    retry: (id: string) => request<void>({ channel: QUEUE_CHANNEL, type: 'retry', id }),
    remove: (id: string) => request<void>({ channel: QUEUE_CHANNEL, type: 'remove', id }),
    clear: () => request<void>({ channel: QUEUE_CHANNEL, type: 'clear' }),
    subscribe(listener: (tasks: ExportTask[]) => void) {
      const onMessage = (message: any, sender: chrome.runtime.MessageSender) => {
        if (
          (transport.id && sender.id !== transport.id) ||
          (sender.url && sender.url !== transport.getURL?.('worker.js'))
        ) {
          return;
        }

        if (message?.channel === 'html2md-queue-update' && Array.isArray(message.tasks)) {
          listener(message.tasks);
        }
      };
      transport.onMessage?.addListener(onMessage);
      return () => transport.onMessage?.removeListener(onMessage);
    },
  };
}
