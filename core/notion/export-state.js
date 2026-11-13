/**
 * @typedef {'pending'|'uncertain'|'confirmed'} StepStatus
 * @typedef {Object} ImageOccurrence
 * @property {string} marker
 * @property {string} url
 * @property {string} alt
 * @property {'pending'|'complete'} status
 * @property {StepStatus} insertion
 * @property {StepStatus} cleanup
 * @property {string} [blockId]
 * @property {string} [insertedId]
 * @property {{reason:string,status?:number}} [error]
 *
 * @typedef {Object} ExportState
 * @property {string} markdown
 * @property {ImageOccurrence[]} occurrences
 * @property {StepStatus} creation
 * @property {StepStatus} writing
 * @property {StepStatus} downloading
 * @property {{id:string}} [page]
 * @property {Map<string, {image:Object,uploadId?:string,error?:Object}>} assets
 * @property {number} failedCount
 */

/** @returns {ExportState} */
export function createExportState({ markdown, occurrences, initialFailures }) {
  return {
    markdown,
    occurrences,
    initialFailures,
    failedCount: initialFailures,
    assets: new Map(),
    creation: 'pending',
    writing: 'pending',
    downloading: 'pending',
  };
}
