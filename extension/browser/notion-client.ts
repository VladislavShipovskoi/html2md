import { failure } from '../../core/errors.ts';
import type { NotionApi } from '../../core/notion/types.ts';

export const NOTION_CHANNEL = 'html2md-notion';
export const notionErrorCodes = [
  'notionSettingsError',
  'integrationNotFound',
  'notionMissingToken',
  'notionInvalidParent',
  'notionUnauthorized',
  'notionForbidden',
  'notionNotFound',
  'notionRateLimited',
  'notionSaveError',
  'notionImageFormat',
  'notionImageUncertain',
] as const;
export type NotionErrorCode = (typeof notionErrorCodes)[number];
export type NotionCommand = {
  [Operation in keyof NotionApi]: {
    channel: typeof NOTION_CHANNEL;
    integrationId: string;
    operation: Operation;
    args: Parameters<NotionApi[Operation]>;
  };
}[keyof NotionApi];
export type NotionResponse =
  | { ok: true; value?: unknown }
  | {
      ok: false;
      code: NotionErrorCode;
      status?: number;
      ambiguous?: boolean;
      imageReason?: 'format';
    };
export interface NotionTransport {
  sendMessage(message: NotionCommand): Promise<NotionResponse>;
}

export function createNotionClient(transport: NotionTransport, integrationId: string): NotionApi {
  async function request<Operation extends keyof NotionApi>(
    operation: Operation,
    args: Parameters<NotionApi[Operation]>
  ): Promise<Awaited<ReturnType<NotionApi[Operation]>>> {
    let response: NotionResponse;
    try {
      response = await transport.sendMessage({
        channel: NOTION_CHANNEL,
        integrationId,
        operation,
        args,
      } as NotionCommand);
    } catch {
      // A lost response must not cause a second page creation or image insertion.
      throw failure('notionSaveError', { ambiguous: operation !== 'children' });
    }

    if (!response || typeof response.ok !== 'boolean') {
      throw failure('notionSaveError', { ambiguous: operation !== 'children' });
    }

    if (response.ok === false) {
      const code = notionErrorCodes.includes(response.code) ? response.code : 'notionSaveError';
      throw failure(code, {
        status: response.status,
        ambiguous: response.ambiguous,
        imageReason: response.imageReason,
      });
    }

    return response.value as Awaited<ReturnType<NotionApi[Operation]>>;
  }
  return {
    createPage: (...args) => request('createPage', args),
    writeMarkdown: (...args) => request('writeMarkdown', args),
    children: (...args) => request('children', args),
    uploadImage: (image) =>
      request('uploadImage', [
        { url: image.url, type: image.type, bytes: Array.from(image.bytes ?? []) },
      ]),
    appendImage: (...args) => request('appendImage', args),
    setCaption: (...args) => request('setCaption', args),
    clearMarker: (...args) => request('clearMarker', args),
    removeBlock: (...args) => request('removeBlock', args),
    writeImageError: (...args) => request('writeImageError', args),
  };
}
