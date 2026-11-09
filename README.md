# HTML to Markdown

[![CI](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml/badge.svg)](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml)
[![Tests](https://github.com/VladislavShipovskoi/html2md/actions/workflows/tests.yml/badge.svg)](https://github.com/VladislavShipovskoi/html2md/actions/workflows/tests.yml)

Chrome extension that extracts the main content of a web page and converts it to
Markdown. Preview and copy the result, or download a ZIP with images for offline use.

## Features

- Main content extraction with Mozilla Readability.
- Markdown headings, lists, links, quotes, tables, and fenced code blocks.
- Code indentation, blank lines, explicit line containers, and `<br>` preservation.
- Separate code blocks and language headings for language tabs present in the page,
  including hidden panels. Short fragments inside explanations remain inline.
- ZIP export with a Markdown file and an `images/` folder using local relative paths.
- English and Russian interfaces, selected by Chrome's language settings, with English
  as the fallback.

## Usage

1. Open page and click the extension icon.
2. Check the extracted title, text size, and availability result.
3. Click **Convert** to preview the Markdown source.
4. Click **Copy** for Markdown with original image URLs, or **Download ZIP** to save
   the Markdown and available images together.
5. Extract the ZIP and keep `images/` beside the Markdown file.

Keep the popup open while the archive is prepared. Unavailable images retain their
original URLs; the popup shows a warning and the archive includes `missing-images.txt`.

## Privacy and limitations

Extraction and conversion run locally, without a server or external conversion API.
Image export requests images from their source URLs using the source tab's same-origin
session. Cross-origin requests follow browser CORS restrictions.

| Permission       | Purpose                                                        |
| ---------------- | -------------------------------------------------------------- |
| `activeTab`      | Temporary access to the page after clicking the extension icon |
| `scripting`      | Extract page content and fetch images in the source tab        |
| `downloads`      | Save ZIP archives                                              |
| `clipboardWrite` | Copy Markdown                                                  |

Persistent access to all websites is not requested. Internal Chrome pages, the Chrome
Web Store, local files, and PDF documents are not supported. Text inside iframes and
images is not extracted. Content absent from the DOM, such as unloaded tab contents
or virtualized editor lines, cannot be recovered automatically.

Article extraction is heuristic: a failed analysis does not prove the page cannot be
converted using another method. Image downloads can fail due to HTTP errors,
authentication, CORS.

## Build

Use Node.js 22.22.2+ or 24.15.0+; CI tests the latest Node.js 22 and 24 releases.

```sh
npm ci
npm run build
```

## Install in Chrome

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked** and select the `dist` folder.
4. Open the extensions menu and pin HTML to Markdown to the toolbar.

After changing the source files, rebuild and click the extension's reload button
on `chrome://extensions`.
