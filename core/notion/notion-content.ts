import type { Article, ImageErrorFormatter } from '../types.ts';
import type { ImageOccurrence } from './export-state.ts';
import { createMarkdown } from '../markdown/markdown.ts';
import { createExportState } from './export-state.ts';

function isolateImage(image: Element, marker: Element, root: Element) {
  const node = image;
  while (
    node.parentElement !== root &&
    !node.parentElement!.matches('li, blockquote, div, section, article')
  ) {
    const parent = node.parentElement!;
    const before = parent.cloneNode(false) as Element;
    const after = parent.cloneNode(false) as Element;
    while (parent.firstChild !== node) {
      before.append(parent.firstChild!);
    }
    while (node.nextSibling) {
      after.append(node.nextSibling);
    }
    parent.replaceWith(before, node, after);

    if (!before.hasChildNodes()) {
      before.remove();
    }

    if (!after.hasChildNodes()) {
      after.remove();
    }
  }
  node.replaceWith(marker);
}

export function prepareNotionExport(
  article: Article,
  document: Document,
  {
    sourceLabel,
    formatImageError,
    createId,
  }: { sourceLabel: string; formatImageError: ImageErrorFormatter; createId: () => string }
) {
  const root = document.createElement('div');
  root.innerHTML = article.content;
  root.querySelectorAll('script, style, iframe, form').forEach((node) => node.remove());
  const occurrences: ImageOccurrence[] = [];
  let initialFailures = 0;
  const prefix = `H2MDIMAGE${createId().replaceAll('-', '')}`;

  for (const image of root.querySelectorAll('img')) {
    let url;
    let reason;
    try {
      const src = image.getAttribute('src');

      if (!src) {
        throw new Error();
      }

      url = new URL(src, article.baseUrl);

      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error();
      }
    } catch {
      reason = 'format';
    }

    if (image.closest('table, pre, code')) {
      reason = 'location';
    }

    if (reason) {
      const strong = document.createElement('strong');
      strong.textContent = formatImageError({ reason });

      if (image.closest('pre, code')) {
        const paragraph = document.createElement('p');
        paragraph.append(strong);
        isolateImage(image, paragraph, root);
      } else {
        image.replaceWith(strong);
      }

      initialFailures++;
      continue;
    }

    const marker = document.createElement('p');
    marker.textContent = `${prefix}N${occurrences.length}END`;
    occurrences.push({
      marker: marker.textContent,
      url: url!.href,
      alt: image.getAttribute('alt') ?? '',
      status: 'pending',
      insertion: 'pending',
      cleanup: 'pending',
    });
    isolateImage(image, marker, root);
  }

  return createExportState({
    markdown: createMarkdown({ ...article, content: root.innerHTML }, document, sourceLabel),
    occurrences,
    initialFailures,
  });
}
