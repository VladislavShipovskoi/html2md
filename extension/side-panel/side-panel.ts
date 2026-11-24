import { errorDetails } from '../../core/errors.ts';
import type { Article } from '../../core/types.ts';
import type { createRuntimeServices } from '../shared/runtime.ts';
import { createMarkdown } from '../../core/index.ts';
import { initializeLocalization } from '../shared/localization.ts';
import { createMessageFormatter } from '../shared/messages.ts';
import { initializeQueueView } from './queue-view.ts';
import { initializeTheme } from '../shared/theme.ts';

export async function initializeSidePanel({
  document,
  i18n,
  browser,
  repository,
  queue,
  createId,
  themeStorage,
  watchSource,
}: ReturnType<typeof createRuntimeServices>) {
  let disposed = false;
  let revision = 0;
  let windowId: number | undefined = undefined;
  let stopSource = () => {};
  let stopFocus = () => {};
  document.defaultView!.addEventListener(
    'pagehide',
    () => {
      disposed = true;
      revision++;
      stopSource();
      stopFocus();
    },
    { once: true }
  );
  const statusEl = document.querySelector<HTMLElement>('#status')!;
  const messageEl = document.querySelector<HTMLElement>('#message')!;
  const mainEl = document.querySelector<HTMLElement>('main')!;
  const { t, locale } = initializeLocalization(document, i18n);
  await initializeTheme({ document, storage: themeStorage, t });

  if (disposed) {
    return;
  }

  const messages = createMessageFormatter(t);
  const titleEl = document.querySelector<HTMLElement>('#page-title')!;
  const sourceEl = document.querySelector<HTMLElement>('#page-source')!;
  const countEl = document.querySelector<HTMLElement>('#text-count')!;
  const detailsEl = document.querySelector<HTMLElement>('#details')!;
  const previewEl = document.querySelector<HTMLTextAreaElement>('#preview')!;
  const outputEl = document.querySelector<HTMLElement>('#output')!;
  let currentArticle: Article | undefined;
  let pageTitle: string;
  let markdown = '';
  let sourceTabId: number;
  let sourceDocumentId = '';
  const pendingCommands = new Map<string, string>();
  const busyButtons = new Set<HTMLButtonElement>();
  const convertButton = document.querySelector<HTMLButtonElement>('#convert')!;
  const actionMessage = document.querySelector<HTMLElement>('#action-message')!;
  const notionButton = document.querySelector<HTMLButtonElement>('#notion-save')!;
  const notionMessage = document.querySelector<HTMLElement>('#notion-message')!;
  const notionSettings = document.querySelector<HTMLElement>('#notion-settings')!;
  const integrationSelect = document.querySelector<HTMLSelectElement>('#integration-select')!;

  const openSettings = async () => {
    try {
      await browser.openSettings();
    } catch {
      notionMessage.textContent = t('notionSettingsError');
    }
  };
  document.querySelector<HTMLElement>('#settings-open')!.addEventListener('click', openSettings);
  notionSettings.addEventListener('click', openSettings);
  let connectionsVersion = 0;
  let connectionsReady = false;
  notionButton.disabled = true;
  async function refreshConnections() {
    const version = ++connectionsVersion;
    try {
      await repository.initialize();
      const records = await repository.list();

      if (disposed || version !== connectionsVersion) {
        return;
      }

      const selected = integrationSelect.value;
      integrationSelect.replaceChildren(
        ...records.map((record) => {
          const option = document.createElement('option');
          option.value = record.id;
          option.textContent = record.name;
          return option;
        })
      );

      if (records.some((record) => record.id === selected)) {
        integrationSelect.value = selected;
      }

      const connected = records.some((record) => record.connected && record.parentId);
      notionSettings.hidden = connected;
      notionMessage.textContent = connected ? '' : t('notionNeedsSettings');
    } catch {
      if (!disposed && version === connectionsVersion) {
        notionMessage.textContent = t('notionSettingsError');
      }
    } finally {
      if (!disposed && version === connectionsVersion) {
        connectionsReady = true;
        notionButton.disabled = busyButtons.has(notionButton);
      }
    }
  }
  const connectionReady = refreshConnections();
  const onFocus = () => {
    void refreshConnections();
  };
  document.defaultView!.addEventListener('focus', onFocus);
  stopFocus = () => document.defaultView!.removeEventListener('focus', onFocus);

  function enqueue(type: 'archive' | 'notion', button: HTMLButtonElement) {
    button.addEventListener('click', () => {
      if (button.disabled || !currentArticle) {
        return;
      }

      button.disabled = true;
      busyButtons.add(button);
      const sourceRevision = revision;
      const integrationId = type === 'notion' ? integrationSelect.value : undefined;
      const snapshot = {
        article: structuredClone(currentArticle),
        title: pageTitle,
        tabId: sourceTabId,
        documentId: sourceDocumentId,
        locale: (locale.startsWith('ru') ? 'ru' : 'en') as 'en' | 'ru',
        options: { sourceLabel: t('sourceLabel') },
      };
      void (async () => {
        try {
          if (type === 'notion') {
            await connectionReady;
          }

          if (type === 'notion' && !integrationId) {
            if (!disposed && sourceRevision === revision) {
              notionMessage.textContent = t('notionNeedsSettings');
              notionSettings.hidden = false;
            }

            return;
          }

          const key = sourceRevision + ':' + type + ':' + (integrationId ?? '');
          const commandId = pendingCommands.get(key) ?? createId();
          pendingCommands.set(key, commandId);
          await queue.enqueue({ type, commandId, snapshot, integrationId });
          pendingCommands.delete(key);

          if (!disposed && sourceRevision === revision) {
            actionMessage.textContent = t('queueAdded');
          }

          await refreshQueue();
        } catch (error) {
          if (!disposed && sourceRevision === revision) {
            actionMessage.textContent = messages.error(error, 'queueStorageError');
          }
        } finally {
          busyButtons.delete(button);

          if (!disposed) {
            button.disabled = type === 'notion' && !connectionsReady;
          }
        }
      })();
    });
  }
  enqueue('notion', notionButton);

  convertButton.addEventListener('click', () => {
    if (!currentArticle) {
      return;
    }

    try {
      markdown = createMarkdown(currentArticle, document, t('sourceLabel'));
      previewEl.value = markdown;
      outputEl.hidden = false;
      convertButton.hidden = true;
      actionMessage.textContent = '';
    } catch {
      actionMessage.textContent = t('conversionError');
    }
  });

  document.querySelector<HTMLElement>('#copy')!.addEventListener('click', async () => {
    const sourceRevision = revision;
    try {
      await browser.copy(markdown);

      if (!disposed && sourceRevision === revision) {
        actionMessage.textContent = t('copied');
      }
    } catch {
      if (!disposed && sourceRevision === revision) {
        actionMessage.textContent = t('copyError');
      }
    }
  });

  enqueue('archive', document.querySelector<HTMLButtonElement>('#download')!);
  const refreshQueue = initializeQueueView(document, queue, t);

  function showResult(available: boolean, explanation: string) {
    statusEl.dataset.state = available ? 'available' : 'unavailable';
    statusEl.textContent = available ? t('conversionAvailable') : t('conversionUnavailable');
    messageEl.textContent = explanation;
  }

  function invalidateSource() {
    revision++;
    currentArticle = undefined;
    sourceDocumentId = '';
    markdown = '';
    previewEl.value = '';
    convertButton.hidden = true;
    outputEl.hidden = true;
    detailsEl.hidden = true;
    pendingCommands.clear();
    actionMessage.textContent = '';
    statusEl.dataset.state = 'loading';
    statusEl.textContent = t('checking');
    messageEl.textContent = t('checkingDescription');
    mainEl.setAttribute('aria-busy', 'true');
  }
  async function analyzePage() {
    if (disposed || windowId === undefined) {
      return;
    }

    invalidateSource();
    const version = revision;
    void refreshConnections();
    try {
      const { tab, result, documentId } = await browser.analyzeActivePage(windowId);

      if (disposed || version !== revision) {
        return;
      }

      showResult(
        result.articleFound,
        result.articleFound ? t('textAvailable') : t('articleNotFound')
      );

      titleEl.textContent = result.title || tab.title || t('untitled');
      try {
        sourceEl.textContent = new URL(result.url || tab.url!).hostname;
      } catch {
        sourceEl.textContent = '';
      }
      countEl.textContent = t('characterCount', result.characters.toLocaleString(locale));
      detailsEl.hidden = false;

      if (result.articleFound) {
        pageTitle = tab.title || result.title || t('untitled');
        currentArticle = {
          ...result,
          title: result.title || tab.title || t('untitled'),
        };
        convertButton.hidden = false;
        sourceTabId = tab.id;
        sourceDocumentId = documentId;
      }
    } catch (caught) {
      if (disposed || version !== revision) {
        return;
      }

      const error = errorDetails(caught);
      const key = ['noActiveTab', 'restrictedPage', 'unsupportedDocument'].includes(
        error.code ?? error.message ?? ''
      )
        ? (error.code ?? error.message)!
        : 'panelGrantAccess';
      showResult(false, t(key));
    } finally {
      if (!disposed && version === revision) {
        mainEl.setAttribute('aria-busy', 'false');
      }
    }
  }

  try {
    const observer = await watchSource((state) => {
      if (disposed || windowId === undefined) {
        return;
      }

      if (state === 'loading') {
        invalidateSource();
      } else {
        void analyzePage();
      }
    });
    stopSource = observer.dispose;

    if (disposed) {
      stopSource();
      return;
    }

    windowId = observer.windowId;
    await analyzePage();
  } catch {
    if (!disposed) {
      showResult(false, t('noActiveTab'));
      mainEl.setAttribute('aria-busy', 'false');
    }
  }
}
