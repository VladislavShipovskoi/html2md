import { zipSync, strToU8 } from 'fflate';
import { createMarkdown, markdownFilename } from './markdown.js';

export function imageUrls(article, document) {
  const template = document.createElement('template');
  template.innerHTML = article.content;
  const urls = [...template.content.querySelectorAll('img[src]')].flatMap((image) => {
    try {
      const url = new URL(image.getAttribute('src'), article.baseUrl);
      return ['http:', 'https:'].includes(url.protocol) ? [url.href] : [];
    } catch {
      return [];
    }
  });
  return [...new Set(urls)];
}

export async function fetchImages(urls) {
  const results = [];
  let totalBytes = 0;

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        credentials: 'same-origin',
        signal: AbortSignal.timeout(10000),
      });
      const type = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase();

      if (!response.ok || !type?.startsWith('image/')) {
        throw new Error(`Image unavailable: HTTP ${response.status}`);
      }

      const reader = response.body.getReader();
      const chunks = [];
      let size = 0;
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        size += value.length;
        totalBytes += value.length;

        if (size > 10 * 1024 * 1024 || totalBytes > 50 * 1024 * 1024) {
          await reader.cancel();
          throw new Error('Image size limit exceeded');
        }

        chunks.push(value);
      }

      if (!size) {
        throw new Error('Empty image');
      }

      const bytes = new Uint8Array(size);
      let offset = 0;

      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }

      results.push({ url, type, bytes: Array.from(bytes) });
    } catch {
      results.push({ url, failed: true });
    }
  }

  return results;
}

export function createArchive(article, images, document, sourceLabel) {
  const extensions = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
    'image/x-icon': 'ico',
  };
  const files = Object.create(null);
  const paths = new Map();
  const failed = [];

  for (const image of images) {
    if (image.failed || !image.bytes?.length) {
      failed.push(image.url);
      continue;
    }

    const path = `images/image-${paths.size + 1}.${extensions[image.type] || 'img'}`;
    files[path] = new Uint8Array(image.bytes);
    paths.set(image.url, path);
  }

  files[markdownFilename(article.title)] = strToU8(
    createMarkdown(article, document, sourceLabel, paths)
  );

  if (failed.length) {
    files['missing-images.txt'] = strToU8(failed.join('\n') + '\n');
  }

  return { bytes: zipSync(files), failedCount: failed.length };
}
