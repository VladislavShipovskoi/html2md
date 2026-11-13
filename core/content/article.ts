import type { PageAnalysis } from '../types.ts';
import { Readability } from '@mozilla/readability';
import { normalizeCodeBlocks } from './code-blocks.ts';

export function analyzePage(document: Document): PageAnalysis {
  const supported = ['text/html', 'application/xhtml+xml'].includes(document.contentType);

  if (!supported) {
    return { supported: false };
  }

  const copy = document.cloneNode(true) as Document;
  normalizeCodeBlocks(copy);
  const codeClasses = [...copy.querySelectorAll('code, pre')].flatMap((node) => [
    ...node.classList,
  ]);
  const article = new Readability(copy, { classesToPreserve: codeClasses }).parse();
  const text = article?.textContent?.trim() ?? '';

  return {
    supported: true,
    title: article?.title || document.title,
    characters: text.length,
    articleFound: text.length > 0,
    content: article?.content ?? '',
    url: document.URL,
    baseUrl: document.baseURI,
  };
}
