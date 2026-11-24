import { errorDetails, failure } from '../../core/errors.ts';
import type {
  ArticleSnapshot,
  ExportTask,
  NewExportTask,
  TaskCheckpoint,
  TaskPayload,
  TaskUpdate,
} from './types.ts';

const errorCodes = [
  'queueStorageError',
  'queueInvalidTask',
  'queueTaskNotFound',
  'queueTaskRunning',
  'queueStaleAttempt',
  'queueTaskNotRetryable',
  'queueTaskNotWaiting',
];
const safeError = (error: unknown) => {
  const code = errorDetails(error).code;
  return failure(code && errorCodes.includes(code) ? code : 'queueStorageError');
};
const read = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

function copySnapshot(snapshot: ArticleSnapshot): ArticleSnapshot {
  const { article, options } = snapshot;
  return {
    article: {
      title: article.title,
      content: article.content,
      url: article.url,
      baseUrl: article.baseUrl,
      characters: article.characters,
    },
    title: snapshot.title,
    tabId: snapshot.tabId,
    documentId: snapshot.documentId,
    locale: snapshot.locale,
    options: { sourceLabel: options.sourceLabel },
  };
}

function copyUpdate({ status, progress, result, error }: TaskUpdate): TaskUpdate {
  return {
    status,
    progress: progress && {
      stage: progress.stage,
      completed: progress.completed,
      total: progress.total,
    },
    result: result && {
      failedCount: result.failedCount,
      pageId: result.pageId,
      downloadId: result.downloadId,
    },
    error: error && { code: error.code, retryable: error.retryable },
  };
}

export function createTaskRepository({
  factory = indexedDB,
  databaseName = 'html2md-export-queue',
  createId = () => crypto.randomUUID(),
  now = Date.now,
}: {
  factory?: IDBFactory;
  databaseName?: string;
  createId?: () => string;
  now?: () => number;
} = {}) {
  let opening: Promise<IDBDatabase> | undefined;
  function open() {
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(databaseName, 1);
      let rejected = false;
      const fail = () => {
        rejected = true;
        opening = undefined;
        reject(failure('queueStorageError'));
      };
      request.onupgradeneeded = () => {
        const db = request.result;
        db.createObjectStore('tasks', { keyPath: 'id' }).createIndex('order', 'order', {
          unique: true,
        });
        db.createObjectStore('payloads');
        db.createObjectStore('commands');
        db.createObjectStore('meta');
      };
      request.onerror = request.onblocked = fail;
      request.onsuccess = () => {
        const db = request.result;

        if (rejected) {
          db.close();
          return;
        }

        db.onversionchange = () => {
          db.close();
          opening = undefined;
        };
        resolve(db);
      };
    }).catch((error) => {
      opening = undefined;
      throw safeError(error);
    });
    return opening;
  }
  async function transaction<T>(
    stores: string[],
    mode: IDBTransactionMode,
    action: (tx: IDBTransaction) => Promise<T>
  ): Promise<T> {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      let tx: IDBTransaction;
      try {
        tx = db.transaction(stores, mode, { durability: 'strict' });
      } catch (error) {
        reject(safeError(error));
        return;
      }
      let value: T;
      let caught: unknown;
      tx.oncomplete = () => resolve(value);
      tx.onabort = () => reject(safeError(caught));
      // Actions await IndexedDB requests only, keeping every write in this transaction.
      void action(tx).then(
        (result) => {
          value = result;
        },
        (error) => {
          caught = error;
          try {
            tx.abort();
          } catch {
            reject(safeError(error));
          }
        }
      );
    });
  }
  async function getTask(tx: IDBTransaction, id: string): Promise<ExportTask> {
    const task = await read<ExportTask | undefined>(tx.objectStore('tasks').get(id));

    if (!task) {
      throw failure('queueTaskNotFound');
    }

    return task;
  }
  async function activeTask(tx: IDBTransaction, id: string, attemptId: string) {
    const task = await getTask(tx, id);

    if (task.status !== 'running' || !attemptId || task.attemptId !== attemptId) {
      throw failure('queueStaleAttempt');
    }

    return task;
  }
  async function nextOrder(tx: IDBTransaction) {
    const meta = tx.objectStore('meta');
    const order = ((await read<number | undefined>(meta.get('order'))) ?? 0) + 1;
    meta.put(order, 'order');
    return order;
  }
  return {
    async enqueue(input: NewExportTask): Promise<string> {
      const { commandId } = input;

      if (
        !input.commandId ||
        !['archive', 'notion'].includes(input.type) ||
        (input.type === 'notion' && (!input.integration?.id || !input.integration.parentId))
      ) {
        throw failure('queueInvalidTask');
      }

      const snapshot = copySnapshot(input.snapshot);
      const destination =
        input.type === 'notion'
          ? {
              type: 'notion' as const,
              integration: {
                id: input.integration.id,
                name: input.integration.name,
                parentId: input.integration.parentId,
              },
            }
          : { type: 'archive' as const };
      return transaction(['tasks', 'payloads', 'commands', 'meta'], 'readwrite', async (tx) => {
        const commands = tx.objectStore('commands');
        const existing = await read<string | undefined>(commands.get(commandId));

        if (existing) {
          return existing;
        }

        const timestamp = now();
        const task: ExportTask = {
          ...destination,
          id: createId(),
          title: snapshot.title,
          status: 'queued',
          order: await nextOrder(tx),
          createdAt: timestamp,
          updatedAt: timestamp,
        };
        tx.objectStore('tasks').add(task);
        tx.objectStore('payloads').add({ snapshot } satisfies TaskPayload, task.id);
        commands.add(task.id, commandId);
        return task.id;
      });
    },
    list: () =>
      transaction(['tasks'], 'readonly', (tx) =>
        read<ExportTask[]>(tx.objectStore('tasks').index('order').getAll())
      ),
    get: (id: string) => transaction(['tasks'], 'readonly', (tx) => getTask(tx, id)),
    loadPayload: (id: string) =>
      transaction(['tasks', 'payloads'], 'readonly', async (tx) => {
        await getTask(tx, id);
        return read<TaskPayload>(tx.objectStore('payloads').get(id));
      }),
    claimNext: () =>
      transaction(['tasks'], 'readwrite', async (tx) => {
        const tasks = await read<ExportTask[]>(tx.objectStore('tasks').index('order').getAll());

        if (tasks.some((task) => task.status === 'running')) {
          return;
        }

        const task = tasks.find((task) => task.status === 'queued');

        if (!task) {
          return;
        }

        task.status = 'running';
        task.attemptId = createId();
        task.updatedAt = now();
        tx.objectStore('tasks').put(task);
        return task;
      }),
    // The scheduler holds a cross-context Web Lock before recovering a stopped executor.
    recover: (id: string, attemptId: string) =>
      transaction(['tasks'], 'readwrite', async (tx) => {
        const task = await activeTask(tx, id, attemptId);
        task.status = 'queued';
        task.updatedAt = now();
        delete task.attemptId;
        tx.objectStore('tasks').put(task);
      }),
    waitForCredentials: (id: string) =>
      transaction(['tasks'], 'readwrite', async (tx) => {
        const task = await getTask(tx, id);

        if (task.status !== 'queued') {
          return;
        }

        task.status = 'waiting_credentials';
        task.updatedAt = now();
        task.error = { code: 'notionMissingToken', retryable: false };
        tx.objectStore('tasks').put(task);
      }),
    update: (id: string, attemptId: string, update: TaskUpdate) => {
      const patch = copyUpdate(update);
      return transaction(['tasks', 'payloads'], 'readwrite', async (tx) => {
        const task = await activeTask(tx, id, attemptId);

        for (const [key, value] of Object.entries(patch)) {
          if (value !== undefined) {
            Object.assign(task, { [key]: value });
          }
        }

        task.updatedAt = now();

        if (task.status === 'completed') {
          delete task.error;
          const payload = await read<TaskPayload>(tx.objectStore('payloads').get(id));
          delete payload.checkpoint;
          tx.objectStore('payloads').put(payload, id);
        }

        tx.objectStore('tasks').put(task);
      });
    },
    saveCheckpoint: async (id: string, attemptId: string, checkpoint: TaskCheckpoint) => {
      let saved: TaskCheckpoint;
      try {
        saved = structuredClone(checkpoint);
      } catch (error) {
        throw safeError(error);
      }
      return transaction(['tasks', 'payloads'], 'readwrite', async (tx) => {
        const task = await activeTask(tx, id, attemptId);

        if (saved.type !== task.type) {
          throw failure('queueInvalidTask');
        }

        const payload = await read<TaskPayload>(tx.objectStore('payloads').get(id));
        payload.checkpoint = saved;
        tx.objectStore('payloads').put(payload, id);
      });
    },
    retry: (id: string) =>
      transaction(['tasks', 'meta', 'payloads'], 'readwrite', async (tx) => {
        const task = await getTask(tx, id);

        if (task.status !== 'failed' || !task.error?.retryable) {
          throw failure('queueTaskNotRetryable');
        }

        task.status = 'queued';
        task.order = await nextOrder(tx);
        task.updatedAt = now();
        delete task.error;
        delete task.progress;
        delete task.attemptId;
        const payload = await read<TaskPayload>(tx.objectStore('payloads').get(id));

        if (payload.checkpoint?.type === 'archive') {
          delete payload.checkpoint.download;
          tx.objectStore('payloads').put(payload, id);
        }

        tx.objectStore('tasks').put(task);
      }),
    resume: (id: string) =>
      transaction(['tasks'], 'readwrite', async (tx) => {
        const task = await getTask(tx, id);

        if (task.status !== 'waiting_credentials') {
          throw failure('queueTaskNotWaiting');
        }

        task.status = 'queued';
        task.updatedAt = now();
        delete task.error;
        delete task.attemptId;
        tx.objectStore('tasks').put(task);
      }),
    remove: (id: string) =>
      transaction(['tasks', 'payloads'], 'readwrite', async (tx) => {
        const task = await getTask(tx, id);

        if (task.status === 'running') {
          throw failure('queueTaskRunning');
        }

        tx.objectStore('tasks').delete(id);
        tx.objectStore('payloads').delete(id);
      }),
    clearCompleted: () =>
      transaction(['tasks', 'payloads'], 'readwrite', async (tx) => {
        const tasks = tx.objectStore('tasks');

        for (const task of await read<ExportTask[]>(tasks.getAll())) {
          if (task.status === 'completed') {
            tasks.delete(task.id);
            tx.objectStore('payloads').delete(task.id);
          }
        }
      }),
    async close() {
      if (opening) {
        (await opening).close();
        opening = undefined;
      }
    },
  };
}

export type TaskRepository = ReturnType<typeof createTaskRepository>;
