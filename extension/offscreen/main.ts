import { createTaskRepository } from '../queue/repository.ts';
import { createTaskTranslator } from '../shared/task-localization.ts';
import { createOffscreenProcessor } from './processor.ts';

const processor = createOffscreenProcessor({
  tasks: createTaskRepository(),
  document,
  translate: createTaskTranslator(chrome.runtime.getURL, fetch),
});
let heartbeat: ReturnType<typeof setInterval> | undefined;
let active = false;
function activity(value: boolean) {
  active = value;

  if ((active || processor.hasBlobs()) && !heartbeat) {
    heartbeat = setInterval(() => {
      void processor
        .cleanup()
        .then(() => {
          if (!active && !processor.hasBlobs()) {
            clearInterval(heartbeat);
            heartbeat = undefined;
          }

          return chrome.runtime.sendMessage({ channel: 'html2md-queue', type: 'wake' });
        })
        .catch(() => {});
    }, 20_000);
  }
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (
    message?.channel !== 'html2md-offscreen' ||
    sender.id !== chrome.runtime.id ||
    (sender.url && sender.url !== chrome.runtime.getURL('worker.js'))
  ) {
    return;
  }

  if (message.type === 'activity') {
    activity(Boolean(message.active));
    respond({ ok: true });
    return;
  }

  if (message.type === 'release') {
    processor.release(message.taskId);
    respond({ ok: true });
    return;
  }

  if (!['prepare', 'image-urls', 'archive-url'].includes(message.type)) {
    return;
  }

  activity(true);
  void processor.process(message.type, message.taskId, message.attemptId).then(
    (value) => respond({ ok: true, value }),
    () => respond({ ok: false })
  );
  return true;
});
