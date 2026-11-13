import type { BrowserOptions, AnalyzedPage } from './types.ts';
import type { ImageResult } from '../../core/types.ts';
import { failure } from '../../core/index.ts';
import { IMAGE_LIMITS } from '../../core/images/index.ts';
import { fetchImagesInPage } from './image-function.ts';

export function createBrowserAdapter({ chrome, clipboard, URL, Blob, setTimeout }: BrowserOptions) {
  return {
    openSettings: () => chrome.runtime.openOptionsPage(),
    copy: (text: string) => clipboard.writeText(text),
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

      const [{ result: rawResult } = {}] = await chrome.scripting.executeScript({
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

      return { tab: { ...tab, id: tab.id! }, result };
    },
    async downloadImages(
      tabId: number,
      urls: string[],
      progress: (completed: number) => void = () => {}
    ) {
      const results: ImageResult[] = [];
      let remaining = IMAGE_LIMITS.totalBytes;
      progress(0);

      for (const url of urls) {
        let image: ImageResult | undefined;
        try {
          const [{ result } = {}] = await chrome.scripting.executeScript({
            target: { tabId },
            world: 'MAIN',
            func: fetchImagesInPage,
            args: [[url], remaining],
          });
          image = (result as ImageResult[] | undefined)?.find((item) => item.url === url);
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
