import { failure } from '../../core/errors.ts';
import { imageUrls, createArchive } from '../../core/index.ts';
import { markdownFilename } from '../../core/markdown/markdown.ts';
import { prepareNotionExport } from '../../core/notion/index.ts';
import { createMessageFormatter } from '../shared/messages.ts';
import type { TaskRepository } from '../queue/repository.ts';
import type { Translate } from '../shared/types.ts';

export function createOffscreenProcessor({
  tasks,
  document,
  translate,
  urls = URL,
}: {
  tasks: TaskRepository;
  document: Document;
  translate: (locale: 'en' | 'ru') => Promise<Translate>;
  urls?: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}) {
  const blobs = new Map<string, string>();
  return {
    async process(type: 'prepare' | 'image-urls' | 'archive-url', id: string, attemptId: string) {
      const task = await tasks.get(id);

      if (task.status !== 'running' || task.attemptId !== attemptId) {
        throw failure('queueStaleAttempt');
      }

      const { snapshot, checkpoint } = await tasks.loadPayload(id);

      if (type === 'image-urls') {
        return imageUrls(snapshot.article, document);
      }

      if (type === 'archive-url') {
        if (checkpoint?.type !== 'archive' || !checkpoint.archive) {
          throw failure('queueInvalidTask');
        }

        if (!blobs.has(id)) {
          blobs.set(
            id,
            urls.createObjectURL(
              new Blob([new Uint8Array(checkpoint.archive.bytes)], { type: 'application/zip' })
            )
          );
        }

        return blobs.get(id);
      }

      const t = await translate(snapshot.locale);

      if (task.type === 'notion') {
        if (checkpoint?.type !== 'notion') {
          const state = prepareNotionExport(snapshot.article, document, {
            sourceLabel: snapshot.options.sourceLabel,
            createId: () => crypto.randomUUID(),
            formatImageError: createMessageFormatter(t).imageError,
          });
          await tasks.saveCheckpoint(id, attemptId, { type: 'notion', state });
        }
      } else {
        if (checkpoint?.type !== 'archive' || !checkpoint.images) {
          throw failure('queueInvalidTask');
        }

        if (!checkpoint.archive) {
          checkpoint.archive = {
            ...createArchive(
              snapshot.article,
              checkpoint.images,
              document,
              snapshot.options.sourceLabel
            ),
            filename: markdownFilename(snapshot.article.title).replace(/\.md$/, '.zip'),
          };
          await tasks.saveCheckpoint(id, attemptId, checkpoint);
        }
      }
    },
    release(id: string) {
      const url = blobs.get(id);

      if (url) {
        urls.revokeObjectURL(url);
        blobs.delete(id);
      }
    },
    async cleanup() {
      for (const id of blobs.keys()) {
        try {
          const task = await tasks.get(id);

          if (task.status === 'completed' || task.status === 'failed') {
            this.release(id);
          }
        } catch (error) {
          if ((error as { code?: string }).code === 'queueTaskNotFound') {
            this.release(id);
          }
        }
      }
    },
    hasBlobs: () => blobs.size > 0,
  };
}
