# Shared core

Portable TypeScript modules for the extension, a future CLI, or a separate web application.
This directory has no imports from `extension/` and does not read global DOM or
Chrome objects. It is source code within this repository, not a published package.

## Entry points

- `index.ts`: article extraction, code normalization, Markdown, image downloads,
  ZIP preparation, and safe errors.
- `images/index.ts`: image operations without loading content converters.
- `notion/index.ts`: page ID validation, token normalization, API client, content
  preparation, export state, and recovery workflow.
- `types.ts` and `notion/export-state.ts`: TypeScript interfaces and state contracts.

Supply a `Document` from a browser, `DOMParser`, or JSDOM. JSDOM remains a caller
dependency and is not bundled into the extension.

```ts
import { analyzePage, createMarkdown, exportArchive, fetchImages } from './core/index.ts';

const article = analyzePage(document);
if (article.supported && article.articleFound) {
  const markdown = createMarkdown(article, document, 'Source');
  const archive = await exportArchive({
    article,
    document,
    sourceLabel: 'Source',
    downloadImages: (urls) => fetchImages(urls, { fetcher: fetch }),
  });
  // The host consumes markdown or saves archive.bytes under archive.filename.
}
```

Image downloads accept an injected `fetcher`, optional fallback and progress
callbacks, and a total-byte budget. Progress events contain
`{ stage, completed, total }`. ZIP preparation returns
`{ bytes, filename, failedCount }` without saving files.

Notion's `createNotionApi({ token, fetcher, sleep })` requires transport and retry
timing from the host. `prepareNotionExport` accepts a DOM, source label, ID
generator, and image-error formatter. `exportNotionArticle` accepts the prepared
state, API, downloader, and progress callbacks. The host retains the state between
retries. Credentials, their storage, localization, and UI remain host concerns.

Chrome tab injection, canvas recovery, clipboard access, and browser downloads are
implemented in `extension/browser/`. The build compiles the tab image downloader
with its core dependencies into a self-contained function; network logic is not
duplicated.

External runtime dependencies are `@mozilla/readability`, `turndown`,
`turndown-plugin-gfm`, and `fflate`, managed by the repository's root package file.
Standard Web APIs used by core are available in modern browsers and Node.js 22/24.
