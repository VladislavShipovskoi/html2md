import TurndownService from 'turndown';
import { gfm } from 'turndown-plugin-gfm';

export function createMarkdown(article, document, sourceLabel) {
  const content = document.createElement('div');
  content.innerHTML = article.content;
  content.querySelectorAll('script, style, iframe, form').forEach((node) => node.remove());

  for (const [selector, attribute] of [
    ['a[href]', 'href'],
    ['img[src]', 'src'],
  ]) {
    for (const node of content.querySelectorAll(selector)) {
      try {
        const url = new URL(node.getAttribute(attribute), article.baseUrl);

        if (['http:', 'https:', 'mailto:', 'tel:'].includes(url.protocol)) {
          node.setAttribute(attribute, url.href);
        } else {
          node.removeAttribute(attribute);
        }
      } catch {
        node.removeAttribute(attribute);
      }
    }
  }

  const firstHeading = content.querySelector('h1, h2');

  if (firstHeading?.textContent.trim() === article.title.trim()) {
    firstHeading.remove();
  }

  const converter = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
    bulletListMarker: '-',
  });
  converter.use(gfm);
  converter.remove(['script', 'style', 'iframe', 'form']);
  const title = article.title.replace(/\s+/g, ' ').replace(/([\\`*_[\]<>#])/g, '\\$1');
  const body = converter.turndown(content).trim();

  if (!body) {
    throw new Error('Empty Markdown');
  }

  return `# ${title}\n\n${sourceLabel}: <${article.url}>\n\n${body}\n`;
}

export function markdownFilename(title) {
  const name = title
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .trim()
    .slice(0, 100)
    .replace(/[. ]+$/g, '');
  const safe = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name) ? `_${name}` : name;
  return `${safe || 'page'}.md`;
}
