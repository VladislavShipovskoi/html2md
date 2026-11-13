import type { Article, ImageResult } from '../types.ts';
import { zipSync, strToU8 } from 'fflate';
import { createMarkdown, markdownFilename } from '../markdown/markdown.ts';

export function createArchive(
  article: Article,
  images: ImageResult[],
  document: Document,
  sourceLabel: string
) {
  const extensions: Record<string, string> = {
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

    const path = `images/image-${paths.size + 1}.${extensions[image.type ?? ''] || 'img'}`;
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
