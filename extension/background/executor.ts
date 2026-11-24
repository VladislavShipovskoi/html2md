import { errorDetails, failure } from '../../core/errors.ts';
import { exportNotionArticle } from '../../core/notion/index.ts';
import type { ExportState } from '../../core/notion/export-state.ts';
import type { NotionApi } from '../../core/notion/types.ts';
import type { ImageResult } from '../../core/types.ts';
import type { TaskRepository } from '../queue/repository.ts';
import type { ArticleSnapshot, ExportTask, TaskCheckpoint, TaskProgress } from '../queue/types.ts';
import type { Translate } from '../shared/types.ts';
import { createMessageFormatter } from '../shared/messages.ts';

export interface ExportExecutorOptions {
  tasks: TaskRepository;
  connected(integrationId: string): Promise<boolean>;
  api(integrationId: string): NotionApi;
  translate(locale: 'en' | 'ru'): Promise<Translate>;
  offscreen<T = void>(message: {
    type: 'prepare' | 'image-urls' | 'archive-url' | 'release' | 'activity';
    taskId?: string;
    attemptId?: string;
    active?: boolean;
  }): Promise<T>;
  images(
    snapshot: ArticleSnapshot,
    urls: string[],
    progress: (count: number) => Promise<void>
  ): Promise<ImageResult[]>;
  downloads: Pick<typeof chrome.downloads, 'download' | 'search'>;
  exclusive(action: () => Promise<void>): Promise<void>;
  publish(): Promise<void>;
}

export function createExportExecutor(options: ExportExecutorOptions) {
  const { tasks, offscreen, downloads, publish } = options;
  let running: Promise<void> | undefined;
  let requested = false;
  async function release(id: string) {
    await offscreen({ type: 'release', taskId: id }).catch(() => {});
  }
  async function reconcile(
    task: ExportTask,
    checkpoint: Extract<TaskCheckpoint, { type: 'archive' }>
  ) {
    const download = checkpoint.download!;

    if (download.id === undefined) {
      const matches = await downloads.search({ url: download.url });

      if (matches.length === 1) {
        download.id = matches[0].id;
        download.phase = 'started';
        await tasks.saveCheckpoint(task.id, task.attemptId!, checkpoint);
      }
    }

    const [item] = download.id === undefined ? [] : await downloads.search({ id: download.id });

    if (item?.state === 'in_progress') {
      return;
    }

    const status =
      item?.state === 'complete'
        ? 'completed'
        : item?.state === 'interrupted'
          ? 'failed'
          : 'needs_review';
    await tasks.update(task.id, task.attemptId!, {
      status,
      result: { failedCount: checkpoint.archive?.failedCount ?? 0, downloadId: download.id },
      error: {
        code: status === 'needs_review' ? 'queueNeedsReview' : 'downloadError',
        retryable: status === 'failed',
      },
    });

    if (status !== 'needs_review') {
      await release(task.id);
    }
  }
  async function execute(task: ExportTask) {
    const attemptId = task.attemptId!;
    const { snapshot } = await tasks.loadPayload(task.id);
    let state: ExportState | undefined;
    let progress: TaskProgress = { stage: 'prepare', completed: 0, total: 0 };
    const saveProgress = async (count: number, total: number) => {
      progress = { stage: 'download', completed: count, total };
      await tasks.update(task.id, attemptId, { progress });
      await publish();
    };
    try {
      await offscreen({ type: 'activity', active: true });
      await tasks.update(task.id, attemptId, { progress });
      await publish();

      if (task.type === 'notion') {
        await offscreen({ type: 'prepare', taskId: task.id, attemptId });
        const checkpoint = (await tasks.loadPayload(task.id)).checkpoint;

        if (checkpoint?.type !== 'notion') {
          throw failure('queueStorageError');
        }

        state = checkpoint.state;
        const checkpointState = async () => {
          await tasks.saveCheckpoint(task.id, attemptId, { type: 'notion', state: state! });
          await tasks.update(task.id, attemptId, {
            progress,
            result: { pageId: state!.page?.id, failedCount: state!.failedCount },
          });
          await publish();
        };
        const formatImageError = createMessageFormatter(
          await options.translate(snapshot.locale)
        ).imageError;
        const exportArticle = () =>
          exportNotionArticle({
            state: state!,
            api: options.api(task.integration.id),
            parentId: task.integration.parentId,
            title: task.title,
            formatImageError,
            checkpoint: checkpointState,
            progress: (event) => {
              progress = event;
            },
            downloadImages: (urls) =>
              options.images(snapshot, urls, (count) => saveProgress(count, urls.length)),
          });
        try {
          await exportArticle();
        } catch (error) {
          if (!errorDetails(error).ambiguous || !state.page) {
            throw error;
          }

          // State-aware recovery verifies markers; uncertain creation/upload never replays.
          await exportArticle();
        }
        await tasks.update(task.id, attemptId, {
          status: 'completed',
          result: { pageId: state.page!.id, failedCount: state.failedCount },
        });
      } else {
        let checkpoint = (await tasks.loadPayload(task.id)).checkpoint;

        if (checkpoint?.type !== 'archive') {
          checkpoint = { type: 'archive' };
        }

        if (!checkpoint.images) {
          const urls = await offscreen<string[]>({
            type: 'image-urls',
            taskId: task.id,
            attemptId,
          });
          checkpoint.images = await options.images(snapshot, urls, (count) =>
            saveProgress(count, urls.length)
          );
          await tasks.saveCheckpoint(task.id, attemptId, checkpoint);
        }

        await offscreen({ type: 'prepare', taskId: task.id, attemptId });
        checkpoint = (await tasks.loadPayload(task.id)).checkpoint;

        if (checkpoint?.type !== 'archive' || !checkpoint.archive) {
          throw failure('queueStorageError');
        }

        const url = await offscreen<string>({ type: 'archive-url', taskId: task.id, attemptId });
        checkpoint.download = { phase: 'starting', url };
        await tasks.saveCheckpoint(task.id, attemptId, checkpoint);
        await tasks.update(task.id, attemptId, {
          progress: { stage: 'save', completed: 0, total: 0 },
        });
        let id: number;
        try {
          id = await downloads.download({
            url,
            filename: checkpoint.archive.filename,
            conflictAction: 'uniquify',
          });
        } catch {
          throw failure('queueNeedsReview', { ambiguous: true });
        }
        checkpoint.download = { phase: 'started', url, id };
        await tasks.saveCheckpoint(task.id, attemptId, checkpoint);
        await reconcile(task, checkpoint);
      }
    } catch (caught) {
      const error = errorDetails(caught);

      if (error.code === 'queueStaleAttempt') {
        return;
      }

      const saved =
        task.type === 'archive' ? (await tasks.loadPayload(task.id)).checkpoint : undefined;

      if (saved?.type === 'archive' && saved.download?.id !== undefined) {
        // Keep a known download running until Chrome can provide its authoritative state.
        throw caught;
      }

      const uncertain =
        error.ambiguous ||
        ['notionImageUncertain', 'queueNeedsReview'].includes(error.code ?? '') ||
        (saved?.type === 'archive' && Boolean(saved.download)) ||
        (error.code === 'queueStorageError' &&
          (Boolean(state?.page) ||
            state?.creation === 'uncertain' ||
            state?.writing === 'uncertain'));
      const waiting = ['notionMissingToken', 'integrationNotFound', 'notionUnauthorized'].includes(
        error.code ?? ''
      );
      await tasks.update(task.id, attemptId, {
        status: waiting ? 'waiting_credentials' : uncertain ? 'needs_review' : 'failed',
        error: {
          code: uncertain ? 'queueNeedsReview' : (error.code ?? 'notionSaveError'),
          retryable: !uncertain && !waiting,
        },
        result: state?.page ? { pageId: state.page.id, failedCount: state.failedCount } : undefined,
      });

      if (!uncertain) {
        await release(task.id);
      }
    } finally {
      await offscreen({ type: 'activity', active: false }).catch(() => {});
      await publish();
    }
  }
  async function connected(task: ExportTask) {
    if (task.type === 'archive') {
      return true;
    }

    try {
      return await options.connected(task.integration.id);
    } catch {
      return false;
    }
  }
  async function drain() {
    for (const task of await tasks.list()) {
      if (task.status === 'running') {
        const checkpoint = (await tasks.loadPayload(task.id)).checkpoint;

        if (checkpoint?.type === 'archive' && checkpoint.download) {
          await reconcile(task, checkpoint);
        } else {
          await tasks.recover(task.id, task.attemptId!);
        }
      }
    }

    for (const task of await tasks.list()) {
      if (
        task.status === 'waiting_credentials' &&
        task.error?.code !== 'notionUnauthorized' &&
        (await connected(task))
      ) {
        await tasks.resume(task.id);
      }

      if (task.status === 'queued' && !(await connected(task))) {
        await tasks.waitForCredentials(task.id);
      }
    }

    for (;;) {
      const task = await tasks.claimNext();

      if (!task) {
        break;
      }

      if (!(await connected(task))) {
        await tasks.update(task.id, task.attemptId!, {
          status: 'waiting_credentials',
          error: { code: 'notionMissingToken', retryable: false },
        });
        continue;
      }

      await execute(task);

      if ((await tasks.get(task.id)).status === 'running') {
        break;
      }
    }

    await publish();
    await offscreen({ type: 'activity', active: false }).catch(() => {});
  }
  return {
    run(): Promise<void> {
      if (running) {
        requested = true;
        return running;
      }

      requested = false;
      running = options
        .exclusive(async () => {
          do {
            requested = false;
            await drain();
          } while (requested);
        })
        .finally(() => {
          running = undefined;
        });
      return running;
    },
    async credentialsChanged(integrationId: string) {
      for (const task of await tasks.list()) {
        if (
          task.type === 'notion' &&
          task.integration.id === integrationId &&
          task.status === 'waiting_credentials'
        ) {
          await tasks.resume(task.id);
        }
      }
    },
  };
}
