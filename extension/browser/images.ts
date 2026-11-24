import type { Fetcher } from '../../core/types.ts';
import { fetchImages } from '../../core/images/index.ts';

export async function canvasImage(url: string, document: Document) {
  const image = [...document.images].find(
    (image) => (image.currentSrc || image.src) === url && image.complete && image.naturalWidth > 0
  );

  if (!image || image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) {
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d')!.drawImage(image, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

  if (blob) {
    return { type: 'image/png', bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  }
}
export function fetchPageImages(
  urls: string[],
  maxTotalBytes: number,
  { document, fetcher }: { document: Document; fetcher: Fetcher }
) {
  return fetchImages(urls, {
    fetcher: async (url, options) => {
      try {
        const response = await fetcher(url, options);
        const needsSession =
          [401, 403].includes(response.status) ||
          (response.ok && !response.headers.get('content-type')?.startsWith('image/'));

        if (!needsSession) {
          return response;
        }

        await response.body?.cancel();
      } catch (error) {
        if (!(error instanceof TypeError) || options?.signal?.aborted) {
          throw error;
        }
      }

      return fetcher(url, { ...options, credentials: 'include' });
    },
    maxTotalBytes,
    credentials: 'same-origin',
    fallback: (url) => canvasImage(url, document),
  });
}
