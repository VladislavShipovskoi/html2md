import { fetchImages } from '../../core/images/index.js';

export async function canvasImage(url, document) {
  const image = [...document.images].find(
    (image) => (image.currentSrc || image.src) === url && image.complete && image.naturalWidth > 0
  );

  if (!image || image.naturalWidth * image.naturalHeight > 16 * 1024 * 1024) {
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));

  if (blob) {
    return { type: 'image/png', bytes: Array.from(new Uint8Array(await blob.arrayBuffer())) };
  }
}
export function fetchPageImages(urls, maxTotalBytes, { document, fetcher }) {
  return fetchImages(urls, {
    fetcher,
    maxTotalBytes,
    credentials: 'include',
    fallback: (url) => canvasImage(url, document),
  });
}
