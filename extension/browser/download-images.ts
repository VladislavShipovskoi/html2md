import type { ChromeHost } from './types.ts';
import type { ImageResult } from '../../core/types.ts';
import { IMAGE_LIMITS } from '../../core/images/index.ts';
import { fetchImagesInPage } from './image-function.ts';

export async function downloadPageImages(
  scripting: ChromeHost['scripting'],
  tabId: number,
  urls: string[],
  progress: (completed: number) => void | Promise<void> = () => {},
  documentId?: string
) {
  const results: ImageResult[] = [];
  let remaining = IMAGE_LIMITS.totalBytes;
  await progress(0);

  for (const url of urls) {
    let image: ImageResult | undefined;
    try {
      const [{ result } = {}] = await scripting.executeScript({
        target: { tabId, ...(documentId ? { documentIds: [documentId] } : {}) },
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
    await progress(results.length);
  }

  return results;
}
