import { failure } from '../../core/index.js';
import { IMAGE_LIMITS } from '../../core/images/index.js';
import { fetchImagesInPage } from './image-function.js';

export function createBrowserAdapter({ chrome, clipboard, URL, Blob, setTimeout }) {
  return {
    openSettings: () => chrome.runtime.openOptionsPage(),
    copy: (text) => clipboard.writeText(text),
    async analyzeActivePage() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

      if (!Number.isInteger(tab?.id)) {
        throw failure('noActiveTab');
      }

      const url = new URL(tab.url ?? 'about:blank');
      const store =
        url.hostname === 'chromewebstore.google.com' ||
        (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'));

      if (!['http:', 'https:'].includes(url.protocol) || store) {
        throw failure('restrictedPage');
      }

      const [{ result } = {}] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['page-analysis.js'],
      });

      if (!result) {
        throw failure('accessError');
      }

      if (!result.supported) {
        throw failure('unsupportedDocument');
      }

      return { tab, result };
    },
    async downloadImages(tabId, urls, progress = () => {}) {
      const results = [];
      let remaining = IMAGE_LIMITS.totalBytes;
      progress(0);

      for (const url of urls) {
        let image;
        try {
          const [{ result } = {}] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: fetchImagesInPage,
            args: [[url], remaining],
          });
          image = result?.find((item) => item.url === url);
        } catch {
          /* An unavailable tab is an image failure, not an export failure. */
        }
        image ??= { url, failed: true, reason: 'tabAccess' };
        remaining = Math.max(0, remaining - (image.transferredBytes ?? image.bytes?.length ?? 0));
        results.push(image);
        progress(results.length);
      }

      return results;
    },
    async downloadArchive(bytes, filename) {
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/zip' }));
      try {
        await chrome.downloads.download({ url, filename, conflictAction: 'uniquify' });
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 30000);
      }
    },
  };
}
