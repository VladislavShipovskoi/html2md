# HTML to Markdown

[![CI](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml/badge.svg)](https://github.com/VladislavShipovskoi/html2md/actions/workflows/ci.yml)

Chrome extension for converting articles to Markdown. Preview and copy text, download a ZIP with images, or save to Notion from a persistent side panel.

- Main content extraction.
- Preserves images, headings, lists, tables, and code blocks.
- Exports ZIP and Notion tasks through a background queue shared across windows.
- Supports multiple Notion connections, light/dark themes, and English/Russian interfaces.

## Install

Requires Chrome 120+. Download and extract the latest [release](https://github.com/VladislavShipovskoi/html2md/releases/latest), open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked**. Select the extracted folder and pin the extension.

To build from source, use Node.js 24.15.0+ (24.x) or 26.x:

```sh
npm ci
npm run build
```

Load `dist/` in Chrome. Rebuild and reload the extension after changes.

## Usage

1. Open an article and click the extension icon.
2. Click **Convert**, then **Copy**, **Download ZIP**, or **Save to Notion**.
3. For ZIP exports, keep the extracted Markdown file beside its `images/` folder.

For Notion, first add a connection in **Settings** with a token and parent page URL or ID. Exports create child pages under that parent.

Enable **Automatically analyze tabs** in settings and approve HTTP/HTTPS site access to analyze articles on tab switches while the panel is open. Otherwise, grant access by clicking the extension icon on each tab. Disable the setting to revoke the optional access.

The export queue continues after closing the panel and retains tasks across browser restarts. Retry recoverable failures from the queue. If a task requires review, check Notion or Chrome downloads before exporting again to avoid duplicates. The queue is hidden when empty.

## Privacy and limitations

- Conversion runs locally. Saving to Notion sends the article and available images to its API.
- Tokens stay in session storage by default. **Remember token on this device** stores them locally across restarts without additional encryption or sync.
- Queued articles and checkpoints are stored locally in IndexedDB; tokens are kept separately. Remove tasks to delete their snapshots.
- Chrome internal pages, the Chrome Web Store, local files, and PDFs are unsupported. Extraction and image downloads may fail on some sites. Keep the source tab open until images are collected.

## Bugs and improvements

I'd be happy to hear your suggestions for improvements and reports of any bugs you find. Open an [issue](https://github.com/VladislavShipovskoi/html2md/issues) to share an idea or report a problem. For bugs, please include steps to reproduce, your Chrome version, and the page URL or a minimal HTML example when possible.

[MIT License](LICENSE)
