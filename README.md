# HTML to Markdown

Chrome extension for converting web pages to Markdown.

The interface and extension description support English and Russian. Chrome selects
the language automatically based on its language settings, with English as the fallback.

Analysis runs locally. The `activeTab` and `scripting` permissions allow the extension
to read the current page after you click its icon; persistent access to all websites is not requested.
Internal Chrome pages, the Chrome Web Store, local files, and PDF documents
are not supported. Text inside iframes and images is not analyzed.

## Build

Requires Node.js 22 or later. There are no third-party dependencies, so `npm install` is not needed.

```sh
npm run build
```

The build clears `dist/`, then copies the contents of `extension/` into it.

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder.
4. Open the extensions menu and pin HTML to Markdown to the toolbar.

After changing the source files, rebuild and click the extension's reload button
on `chrome://extensions`.
