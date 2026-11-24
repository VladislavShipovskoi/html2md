# Shared core

Portable TypeScript modules with no imports from `extension/` or global DOM/Chrome access. Supply the DOM, network transport, and timing from the host. This is repository source, not a published package.

## Entry points

- `index.ts`: article extraction, Markdown conversion, images, and ZIP export.
- `images/index.ts`: standalone image operations.
- `notion/index.ts`: Notion API client, content preparation, and export recovery.
- `types.ts`, `notion/types.ts`, and `notion/export-state.ts`: public contracts.

## Markdown and ZIP

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
  // Consume markdown or save archive.bytes under archive.filename.
}
```

Supply a browser Document or JSDOM document. ZIP export returns `{ bytes, filename, failedCount }`; the host saves the file. Progress callbacks receive `{ stage, completed, total }`.

## Notion and recovery

1. Create an API with `createNotionApi({ token, fetcher, sleep })`.
2. Prepare state with `prepareNotionExport(article, document, { sourceLabel, createId, formatImageError })`.
3. Pass the state, API, destination, downloader, and formatter to `exportNotionArticle`.

For durable recovery, supply `checkpoint: () => saveState(structuredClone(state))`. The callback receives no arguments and must resolve only after persistence succeeds. A failed checkpoint stops the workflow. Use structured-clone-compatible storage: plain JSON does not preserve the state's Maps and image bytes.

Resume with the saved state and original destination. Confirmed steps are reused; uncertain writes are reconciled when possible. `notionImageUncertain` requires review rather than a blind retry.

The host owns credentials, persistence, scheduling, downloads, localization, and UI. Keep credentials outside export state; browser adapters belong in `extension/`.
