import type { ArchiveOptions, ArchiveResult } from '../types.ts';
import { imageUrls } from '../images/images.ts';
import { createArchive } from './image-archive.ts';
import { markdownFilename } from '../markdown/markdown.ts';

export async function exportArchive({
  article,
  document,
  sourceLabel,
  downloadImages,
  progress,
}: ArchiveOptions): Promise<ArchiveResult> {
  const images = await downloadImages(imageUrls(article, document), progress);
  const archive = createArchive(article, images, document, sourceLabel);
  return { ...archive, filename: markdownFilename(article.title).replace(/\.md$/, '.zip') };
}
