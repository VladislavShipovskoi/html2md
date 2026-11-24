import type { BrowserOptions, AnalyzedPage } from './types.ts';
import { failure } from '../../core/index.ts';
import { downloadPageImages } from './download-images.ts';

export function createBrowserAdapter({ chrome, clipboard, URL, Blob, setTimeout }: BrowserOptions) {
  return {
    openSettings: () => chrome.runtime.openOptionsPage(),
    copy: (text: string) => clipboard.writeText(text),
    async analyzeActivePage(windowId?: number) {
      const [tab] = await chrome.tabs.query({
        active: true,
        ...(windowId === undefined ? { currentWindow: true } : { windowId }),
      });

      if (!Number.isInteger(tab?.id)) {
        throw failure('noActiveTab');
      }

      if (!tab.url) {
        throw failure('accessError');
      }

      const url = new URL(tab.url);
      const store =
        url.hostname === 'chromewebstore.google.com' ||
        (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));

      if (!['http:', 'https:'].includes(url.protocol) || store) {
        throw failure('restrictedPage');
      }

      const [{ result: rawResult, documentId } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id! },
        files: ['page-analysis.js'],
      });
      const result = rawResult as AnalyzedPage | { supported: false } | undefined;

      if (!result) {
        throw failure('accessError');
      }

      if (!result.supported) {
        throw failure('unsupportedDocument');
      }

      return { tab: { ...tab, id: tab.id! }, result, documentId: documentId ?? '' };
    },
    downloadImages: (tabId: number, urls: string[], progress?: (count: number) => void) =>
      downloadPageImages(chrome.scripting, tabId, urls, progress),
    async downloadArchive(bytes: Uint8Array, filename: string) {
      const url = URL.createObjectURL(
        new Blob([new Uint8Array(bytes)], { type: 'application/zip' })
      );
      try {
        await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    },
  };
}
