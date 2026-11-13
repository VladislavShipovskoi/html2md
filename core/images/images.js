export const IMAGE_LIMITS = Object.freeze({
  imageBytes: 10 * 1024 * 1024,
  totalBytes: 50 * 1024 * 1024,
  timeoutMs: 10000,
});

/** Resolve supported image URLs from an explicitly supplied DOM. */
export function imageUrls(article, document) {
  const template = document.createElement('template');
  template.innerHTML = article.content;
  return [
    ...new Set(
      [...template.content.querySelectorAll('img[src]')].flatMap((image) => {
        try {
          const url = new URL(image.getAttribute('src'), article.baseUrl);
          return ['http:', 'https:'].includes(url.protocol) ? [url.href] : [];
        } catch {
          return [];
        }
      })
    ),
  ];
}

/**
 * @param {string[]} urls
 * @param {{fetcher:Function, maxTotalBytes?:number, credentials?:RequestCredentials,
 * fallback?:Function, progress?:Function}} options
 * @returns {Promise<import('../types.js').ImageResult[]>}
 */
export async function fetchImages(
  urls,
  {
    fetcher,
    maxTotalBytes = IMAGE_LIMITS.totalBytes,
    credentials = 'same-origin',
    fallback,
    progress = () => {},
  }
) {
  const results = [];
  let totalBytes = 0;
  progress({ stage: 'download', completed: 0, total: urls.length });

  for (const url of urls) {
    let size = 0;
    try {
      if (totalBytes >= maxTotalBytes) {
        throw Object.assign(new Error(), { reason: 'totalSize' });
      }

      const response = await fetcher(url, {
        credentials,
        signal: AbortSignal.timeout(IMAGE_LIMITS.timeoutMs),
      });
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();

      if (!response.ok) {
        throw Object.assign(new Error(), { reason: 'http', status: response.status });
      }

      if (!type?.startsWith('image/')) {
        throw Object.assign(new Error(), { reason: 'format' });
      }

      const reader = response.body.getReader();
      const chunks = [];
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        size += value.length;
        totalBytes += value.length;

        if (size > IMAGE_LIMITS.imageBytes || totalBytes > maxTotalBytes) {
          await reader.cancel();
          throw Object.assign(new Error(), {
            reason: size > IMAGE_LIMITS.imageBytes ? 'size' : 'totalSize',
          });
        }

        chunks.push(value);
      }

      if (!size) {
        throw Object.assign(new Error(), { reason: 'empty' });
      }

      const bytes = new Uint8Array(size);
      let offset = 0;

      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      results.push({ url, type, bytes: Array.from(bytes), transferredBytes: size });
    } catch (error) {
      let recovered = false;

      if (fallback && !['size', 'totalSize'].includes(error.reason)) {
        try {
          const image = await fallback(url);

          if (image?.bytes?.length) {
            size += image.bytes.length;
            totalBytes += image.bytes.length;

            if (image.bytes.length > IMAGE_LIMITS.imageBytes || totalBytes > maxTotalBytes) {
              error.reason = image.bytes.length > IMAGE_LIMITS.imageBytes ? 'size' : 'totalSize';
            } else {
              results.push({ ...image, url, transferredBytes: size });
              recovered = true;
            }
          }
        } catch {
          /* A failed optional recovery must not hide the source failure. */
        }
      }

      if (!recovered) {
        results.push({
          url,
          failed: true,
          reason:
            error.reason ??
            (['TimeoutError', 'AbortError'].includes(error.name) ? 'timeout' : 'network'),
          status: error.status,
          transferredBytes: size,
        });
      }
    }
    progress({ stage: 'download', completed: results.length, total: urls.length });
  }

  return results;
}
