# HTML to Markdown

[![CI](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml/badge.svg)](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml)
[![Tests](https://github.com/VladislavShipovskoi/html2md/actions/workflows/tests.yml/badge.svg)](https://github.com/VladislavShipovskoi/html2md/actions/workflows/tests.yml)

Simple chrome extension that extracts the main content of a web page and converts it to Markdown. Preview and copy the result, download a ZIP with images, or save an articleto Notion.

## Features

- Main content extraction with Mozilla Readability.
- Markdown headings, lists, links, quotes, tables, and fenced code blocks.
- Code indentation, blank lines, explicit line containers, and `<br>` preservation.
- Separate code blocks and language headings for language tabs present in the page,
  including hidden panels. Short fragments inside explanations remain inline.
- ZIP export with a Markdown file and an `images/` folder using local relative paths.
- Notion export with image uploads, progress reporting, and recovery from partial saves.
- Multiple named Notion connections managed on a separate settings page.
- Light and dark themes shared between the popup and settings.
- English and Russian interfaces, selected by Chrome's language settings, with English
  as the fallback.

## Usage

1. Open page and click the extension icon.
2. Check the extracted title, text size, and availability result.
3. Click **Convert** to preview the Markdown source.
4. Click **Copy** for Markdown with original image URLs, or **Download ZIP** to save
   the Markdown and available images together.
5. Extract the ZIP and keep `images/` beside the Markdown file.

### Save to Notion

1. Open **Settings** from the popup and choose **Add integration**.
2. Enter a name, a Notion presonal access token, and the parent page URL or ID.
3. Save the connection, then reopen the extension on the article page.
4. Convert the article, select the connection, and click **Save to Notion**.
5. Keep the popup open until saving finishes, then use **Open page in Notion**.

The extension creates a child page under the configured parent and uploads available images. Failed or unsupported images are replaced with bold error explanations. Images inside tables or code blocks cannot be exported as Notion image blocks.

If a save partially succeeds, retry within the same popup so it can reuse the page and its progress. Export recovery state is not retained after closing the popup. When an operation cannot be confirmed, check the Notion page before starting a new export to avoid duplicates.

## Privacy and limitations

Connection names and parent page IDs persist locally. Tokens are held in `chrome.storage.session`, without disk persistence or sync. Enter them again after restarting Chrome or reloading the extension. When editing a connection, leave the token field blank to keep its current session token. Deleting a connection removes its settings and session token.

Page extraction and Markdown conversion run locally. ZIP export downloads images from their source URLs in the source tab, using its browser session. Saving to Notion sends the article and downloaded images directly to the Notion API.

Persistent access to all websites is not requested. Internal Chrome pages, the Chrome Web Store, local files, and PDF documents are not supported. Text inside iframes and images is not extracted. Content absent from the DOM, such as unloaded tab contents or virtualized editor lines, cannot be recovered automatically.

Article extraction is heuristic and may not find the main content on every page. Image downloads can fail because of HTTP errors, authentication, timeouts, or CORS. When possible, a displayed image can be recovered through canvas as PNG, subject to browser security restrictions.

The extension enforces its own image limits: 10 MiB per image, 50 MiB of total transferred image data per export and a 10-second timeout for each image fetch. These limits are defined in `IMAGE_LIMITS` in `core/images/images.ts` to bound memory use and waiting time; they are not Chrome or Notion limits.

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

## Feedback

I'd be happy to hear your suggestions for improvements and reports of any bugs you find. Open an [issue](https://github.com/VladislavShipovskoi/html2md/issues) to share an idea or report a problem. For bugs, please include steps to reproduce, your Chrome version, and the page URL or a minimal HTML example when possible.

## License

This project is licensed under the [MIT License](LICENSE).
