import { errorDetails } from '../../core/errors.ts';
import type { Article } from '../../core/types.ts';
import type { ExportState } from '../../core/notion/export-state.ts';
import type { createRuntimeServices } from '../shared/runtime.ts';
import { createMarkdown } from '../../core/index.ts';
import { exportArchive } from '../../core/index.ts';
import { prepareNotionExport } from '../../core/notion/index.ts';
import { exportNotionArticle } from '../../core/notion/index.ts';
import { initializeLocalization } from '../shared/localization.ts';
import { createMessageFormatter } from '../shared/messages.ts';
import { initializeTheme } from '../shared/theme.ts';

export async function initializePopup({
  document,
  i18n,
  browser,
  repository,
  notionApi,
  createId,
  themeStorage,
}: ReturnType<typeof createRuntimeServices>) {
  const statusEl = document.querySelector<HTMLElement>('#status')!;
  const messageEl = document.querySelector<HTMLElement>('#message')!;
  const mainEl = document.querySelector<HTMLElement>('main')!;
  const { t, locale } = initializeLocalization(document, i18n);
  await initializeTheme({ document, storage: themeStorage, t });
  const messages = createMessageFormatter(t);
  let currentArticle: Article;
  let pageTitle: string;
  let markdown = '';
  let sourceTabId: number;
  const convertButton = document.querySelector<HTMLButtonElement>('#convert')!;
  const actionMessage = document.querySelector<HTMLElement>('#action-message')!;
  const notionButton = document.querySelector<HTMLButtonElement>('#notion-save')!;
  const notionMessage = document.querySelector<HTMLElement>('#notion-message')!;
  const notionLink = document.querySelector<HTMLAnchorElement>('#notion-link')!;
  const notionProgress = document.querySelector<HTMLProgressElement>('#notion-progress')!;
  const notionSettings = document.querySelector<HTMLElement>('#notion-settings')!;
  notionProgress.setAttribute('aria-label', t('notionSave'));
  let exportState: ExportState | undefined;
  let saved = false;
  const integrationSelect = document.querySelector<HTMLSelectElement>('#integration-select')!;
  let pendingIntegrationId: string | undefined;

  const openSettings = async () => {
    try {
      await browser.openSettings();
    } catch {
      notionMessage.textContent = t('notionSettingsError');
    }
  };
  document.querySelector<HTMLElement>('#settings-open')!.addEventListener('click', openSettings);
  notionSettings.addEventListener('click', openSettings);
  const connectionReady = repository
    .initialize()
    .then(() => repository.list())
    .then((records) => {
      for (const record of records) {
        const option = document.createElement('option');
        option.value = record.id;
        option.textContent = record.name;
        integrationSelect.append(option);
      }

      if (!records.some((record) => record.connected && record.parentId)) {
        notionMessage.textContent = t('notionNeedsSettings');
        notionSettings.hidden = false;
      }
    })
    .catch(() => {
      notionMessage.textContent = t('notionSettingsError');
    });

  notionButton.addEventListener('click', async () => {
    if (saved) {
      return;
    }

    notionButton.disabled = true;
    notionSettings.hidden = true;
    notionMessage.textContent = t('notionSaving');
    try {
      await connectionReady;
      const id = pendingIntegrationId ?? integrationSelect.value;

      if (!id) {
        notionMessage.textContent = t('notionNeedsSettings');
        notionSettings.hidden = false;
        return;
      }

      const { token, parentId } = await repository.connection(id);

      if (!token || !parentId) {
        notionMessage.textContent = t('notionNeedsSettings');
        notionSettings.hidden = false;
        return;
      }

      exportState ??= prepareNotionExport(currentArticle, document, {
        sourceLabel: t('sourceLabel'),
        formatImageError: messages.imageError,
        createId,
      });
      pendingIntegrationId = id;
      integrationSelect.disabled = true;

      await exportNotionArticle({
        state: exportState,
        api: notionApi(token),
        parentId,
        title: pageTitle,
        formatImageError: messages.imageError,
        progress: (event) => {
          notionMessage.textContent = messages.progress(event);
          notionProgress.hidden = false;

          if (event.total > 0 && event.stage !== 'finish') {
            notionProgress.max = event.total;
            notionProgress.value = event.completed;
          } else {
            notionProgress.removeAttribute('value');
          }
        },
        onPage: (page) => {
          notionLink.href = 'https://app.notion.com/' + page.id.replaceAll('-', '');
          notionLink.hidden = false;
        },
        downloadImages: (urls, progress) => browser.downloadImages(sourceTabId, urls, progress),
      });

      saved = true;
      notionMessage.textContent = exportState.failedCount
        ? t('notionSavedImageErrors', String(exportState.failedCount))
        : t('notionSaved');
    } catch (caught) {
      const error = errorDetails(caught);
      notionMessage.textContent = messages.error(error);

      if (exportState?.page) {
        notionMessage.textContent += ` ${t('notionPartialSave')}`;
      }
    } finally {
      notionButton.disabled = saved;
      notionProgress.hidden = true;
    }
  });

  convertButton.addEventListener('click', () => {
    try {
      markdown = createMarkdown(currentArticle, document, t('sourceLabel'));
      document.querySelector<HTMLTextAreaElement>('#preview')!.value = markdown;
      document.querySelector<HTMLElement>('#output')!.hidden = false;
      convertButton.hidden = true;
      actionMessage.textContent = '';
    } catch {
      actionMessage.textContent = t('conversionError');
    }
  });

  document.querySelector<HTMLElement>('#copy')!.addEventListener('click', async () => {
    try {
      await browser.copy(markdown);
      actionMessage.textContent = t('copied');
    } catch {
      actionMessage.textContent = t('copyError');
    }
  });

  const downloadButton = document.querySelector<HTMLButtonElement>('#download')!;
  downloadButton.addEventListener('click', async () => {
    downloadButton.disabled = true;
    actionMessage.textContent = t('preparingArchive');
    try {
      const archive = await exportArchive({
        article: currentArticle,
        document,
        sourceLabel: t('sourceLabel'),
        downloadImages: (urls) => browser.downloadImages(sourceTabId, urls),
      });
      await browser.downloadArchive(archive.bytes, archive.filename);
      actionMessage.textContent = archive.failedCount
        ? t('archiveMissingImages', String(archive.failedCount))
        : t('downloadStarted');
    } catch {
      actionMessage.textContent = t('downloadError');
    } finally {
      downloadButton.disabled = false;
    }
  });

  function showResult(available: boolean, explanation: string) {
    statusEl.dataset.state = available ? 'available' : 'unavailable';
    statusEl.textContent = available ? t('conversionAvailable') : t('conversionUnavailable');
    messageEl.textContent = explanation;
  }

  async function analyzePage() {
    try {
      const { tab, result } = await browser.analyzeActivePage();

      showResult(
        result.articleFound,
        result.articleFound ? t('textAvailable') : t('articleNotFound')
      );

      document.querySelector<HTMLElement>('#page-title')!.textContent =
        result.title || tab.title || t('untitled');
      try {
        document.querySelector<HTMLElement>('#page-source')!.textContent = new URL(
          result.url || tab.url!
        ).hostname;
      } catch {
        document.querySelector<HTMLElement>('#page-source')!.textContent = '';
      }
      document.querySelector<HTMLElement>('#text-count')!.textContent = t(
        'characterCount',
        result.characters.toLocaleString(locale)
      );
      document.querySelector<HTMLElement>('#details')!.hidden = false;

      if (result.articleFound) {
        pageTitle = tab.title || result.title || t('untitled');
        currentArticle = {
          ...result,
          title: result.title || tab.title || t('untitled'),
        };
        convertButton.hidden = false;
        sourceTabId = tab.id;
      }
    } catch (caught) {
      const error = errorDetails(caught);
      const key = ['noActiveTab', 'restrictedPage', 'unsupportedDocument'].includes(
        error.code ?? error.message ?? ''
      )
        ? (error.code ?? error.message)!
        : 'accessError';
      showResult(false, t(key));
    } finally {
      mainEl.setAttribute('aria-busy', 'false');
    }
  }

  await analyzePage();
}
