# HTML to Markdown

[![CI](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml/badge.svg)](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml)
[![Tests](https://github.com/VladislavShipovskoi/html2md/actions/workflows/tests.yml/badge.svg)](https://github.com/VladislavShipovskoi/html2md/actions/workflows/tests.yml)

Chrome extension for converting web pages to Markdown.

Click the extension icon to check whether Mozilla Readability can extract the main
content of the current page. The popup shows the extracted title and character count.
If extraction fails, it reports that no article was found; this does not mean that
the page cannot be converted by another method. Markdown conversion is not implemented yet.

The interface and extension description support English and Russian. Chrome selects
the language automatically based on its language settings, with English as the fallback.

Analysis runs locally. The `activeTab` and `scripting` permissions allow the extension
to read the current page after you click its icon; persistent access to all websites is not requested.
Internal Chrome pages, the Chrome Web Store, local files, and PDF documents
are not supported. Text inside iframes and images is not analyzed.

## Build

Requires Node.js 22 or later.

```sh
npm ci
npm run build
npm test
```

The build clears `dist/`, copies the extension files, and bundles Mozilla Readability
with esbuild. All analysis code is included locally; no remote scripts are loaded.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder.
4. Open the extensions menu and pin HTML to Markdown to the toolbar.

After changing the source files, rebuild and click the extension's reload button
on `chrome://extensions`.
