import type { createQueueClient } from '../queue/commands.ts';
import type { ExportTask } from '../queue/types.ts';
import type { Translate } from '../shared/types.ts';

export function initializeQueueView(
  document: Document,
  queue: ReturnType<typeof createQueueClient>,
  t: Translate
) {
  const section = document.querySelector<HTMLElement>('.queue-section')!;
  const list = document.getElementById('queue-list')!;
  const message = document.getElementById('queue-message')!;
  let version = 0;
  let disposed = false;
  function render(tasks: ExportTask[]) {
    if (disposed) {
      return;
    }

    version++;
    message.textContent = '';
    section.hidden = tasks.length === 0;
    list.replaceChildren(
      ...tasks.map((task) => {
        const item = document.createElement('li');
        item.className = 'queue-task';
        const title = document.createElement('strong');
        title.textContent = task.title;
        item.append(title);
        const status = document.createElement('p');
        status.textContent = `${task.type === 'archive' ? 'ZIP' : `Notion · ${task.integration.name}`} · ${t('task_' + task.status)}`;
        item.append(status);

        if (task.status === 'running' && task.progress) {
          const stage = document.createElement('p');
          stage.textContent = t('stage_' + task.progress.stage);
          item.append(stage);
          const progress = document.createElement('progress');
          progress.setAttribute('aria-label', t('queueTitle'));

          if (task.progress.total > 0) {
            progress.max = task.progress.total;
            progress.value = task.progress.completed;
          }

          item.append(progress);
        }

        if (task.error) {
          const error = document.createElement('p');
          error.textContent =
            t(task.status === 'needs_review' ? 'queueNeedsReview' : task.error.code) ||
            t('notionSaveError');
          item.append(error);
        }

        if (task.result?.failedCount) {
          const warning = document.createElement('p');
          warning.textContent = t('queueImageWarning', String(task.result.failedCount));
          item.append(warning);
        }

        if (task.result?.pageId) {
          const link = document.createElement('a');
          link.href = `https://app.notion.com/p/${task.result.pageId.replaceAll('-', '')}`;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          link.textContent = t('notionOpenPage');
          item.append(link);
        }

        for (const action of ['retry', 'remove'] as const) {
          if (
            action === 'retry'
              ? task.status !== 'failed' || !task.error?.retryable
              : task.status === 'running'
          ) {
            continue;
          }

          const button = document.createElement('button');
          button.type = 'button';
          button.textContent = t(action === 'retry' ? 'queueRetry' : 'queueRemove');
          button.addEventListener('click', () => {
            button.disabled = true;
            void queue[action](task.id)
              .then(refresh)
              .catch(() => {
                message.textContent = t('queueStorageError');
              })
              .finally(() => {
                button.disabled = false;
              });
          });
          item.append(button);
        }

        return item;
      })
    );
  }
  async function refresh() {
    const revision = version;
    try {
      const tasks = await queue.list();

      if (revision === version) {
        render(tasks);
      }
    } catch {
      if (!disposed) {
        section.hidden = false;
        message.textContent = t('queueStorageError');
      }
    }
  }
  const unsubscribe = queue.subscribe(render);
  document.defaultView!.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      unsubscribe();
    },
    { once: true }
  );
  document.getElementById('queue-clear')!.addEventListener('click', () => {
    void queue
      .clear()
      .then(refresh)
      .catch(() => {
        message.textContent = t('queueStorageError');
      });
  });
  void refresh();
  return refresh;
}
