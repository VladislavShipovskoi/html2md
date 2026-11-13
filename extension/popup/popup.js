import { createMarkdown } from '../../core/index.js';
import { exportArchive } from '../../core/index.js';
import { prepareNotionExport } from '../../core/notion/index.js';
import { exportNotionArticle } from '../../core/notion/index.js';
import { initializeLocalization } from '../shared/localization.js';
import { createMessageFormatter } from '../shared/messages.js';

export async function initializePopup({
  document,
  i18n,
  browser,
  repository,
  notionApi,
  createId,
}) {
  const statusEl = document.querySelector('#status');
  const messageEl = document.querySelector('#message');
  const mainEl = document.querySelector('main');
  const { t, locale } = initializeLocalization(document, i18n);
  const messages = createMessageFormatter(t);
  let currentArticle;
  let pageTitle;
  let markdown = '';
  let sourceTabId;
  const convertButton = document.querySelector('#convert');
  const actionMessage = document.querySelector('#action-message');
  const notionButton = document.querySelector('#notion-save');
  const notionMessage = document.querySelector('#notion-message');
  const notionLink = document.querySelector('#notion-link');
  const notionProgress = document.querySelector('#notion-progress');
  const notionSettings = document.querySelector('#notion-settings');
  notionProgress.setAttribute('aria-label', t('notionSave'));
  let exportState;
  let saved = false;
  const integrationSelect = document.querySelector('#integration-select');
  let pendingIntegrationId;

  const openSettings = async () => {
    try {
      await browser.openSettings();
    } catch {
      notionMessage.textContent = t('notionSettingsError');
    }
  };
  document.querySelector('#settings-open').addEventListener('click', openSettings);
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
    } catch (error) {
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
      document.querySelector('#preview').value = markdown;
      document.querySelector('#output').hidden = false;
      convertButton.hidden = true;
      actionMessage.textContent = '';
    } catch {
      actionMessage.textContent = t('conversionError');
    }
  });

  document.querySelector('#copy').addEventListener('click', async () => {
    try {
      await browser.copy(markdown);
      actionMessage.textContent = t('copied');
    } catch {
      actionMessage.textContent = t('copyError');
    }
  });

  const downloadButton = document.querySelector('#download');
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

  function showResult(available, explanation) {
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

      document.querySelector('#page-title').textContent =
        result.title || tab.title || t('untitled');
      try {
        document.querySelector('#page-source').textContent = new URL(
          result.url || tab.url
        ).hostname;
      } catch {
        document.querySelector('#page-source').textContent = '';
      }
      document.querySelector('#text-count').textContent = t(
        'characterCount',
        result.characters.toLocaleString(locale)
      );
      document.querySelector('#details').hidden = false;

      if (result.articleFound) {
        pageTitle = tab.title || result.title || t('untitled');
        currentArticle = {
          ...result,
          title: result.title || tab.title || t('untitled'),
        };
        convertButton.hidden = false;
        sourceTabId = tab.id;
      }
    } catch (error) {
      const key = ['noActiveTab', 'restrictedPage', 'unsupportedDocument'].includes(
        error.code ?? error.message
      )
        ? (error.code ?? error.message)
        : 'accessError';
      showResult(false, t(key));
    } finally {
      mainEl.setAttribute('aria-busy', 'false');
    }
  }

  await analyzePage();
}
