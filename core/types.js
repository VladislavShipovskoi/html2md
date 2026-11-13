/**
 * DOM is always supplied by the caller: a browser document or a JSDOM document.
 * @typedef {Object} Article
 * @property {string} title
 * @property {string} content Extracted HTML.
 * @property {string} url Source URL.
 * @property {string} baseUrl Base for relative media and links.
 * @property {number} [characters]
 *
 * @typedef {Object} ImageResult
 * @property {string} url
 * @property {string} [type] MIME type.
 * @property {number[]|Uint8Array} [bytes]
 * @property {boolean} [failed]
 * @property {string} [reason] Safe reason code; never an arbitrary server message.
 * @property {number} [status] HTTP status, when available.
 * @property {number} transferredBytes Includes failed transfer and fallback bytes.
 *
 * @typedef {Object} ArchiveResult
 * @property {Uint8Array} bytes
 * @property {string} filename
 * @property {number} failedCount
 *
 * @typedef {Object} Progress
 * @property {'download'|'upload'|'finish'} stage
 * @property {number} completed
 * @property {number} total
 */
export {};
