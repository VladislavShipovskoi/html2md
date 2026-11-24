import { errorDetails, failure } from '../../core/errors.ts';
import { createNotionApi } from '../../core/notion/index.ts';
import type { NotionApi, NotionFetcher } from '../../core/notion/types.ts';
import { IMAGE_LIMITS } from '../../core/images/index.ts';
import { NOTION_CHANNEL, notionErrorCodes } from '../browser/notion-client.ts';
import type { NotionResponse } from '../browser/notion-client.ts';
import type { createIntegrationRepository } from '../integrations/integrations.ts';

const isId = (value: unknown) =>
  typeof value === 'string' &&
  /^(?:[a-f0-9]{32}|[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})$/i.test(value);
const isText = (value: unknown) => typeof value === 'string';
const isBlockType = (value: unknown) =>
  typeof value === 'string' &&
  [
    'paragraph',
    'bulleted_list_item',
    'numbered_list_item',
    'quote',
    'heading_1',
    'heading_2',
    'heading_3',
  ].includes(value);

function validOperation(operation: unknown, args: unknown[]): operation is keyof NotionApi {
  switch (operation) {
    case 'createPage':
    case 'writeMarkdown':
    case 'setCaption':
      return args.length === 2 && isId(args[0]) && isText(args[1]);
    case 'children':
    case 'removeBlock':
      return args.length === 1 && isId(args[0]);
    case 'clearMarker':
      return args.length === 2 && isId(args[0]) && isBlockType(args[1]);
    case 'writeImageError':
      return args.length === 3 && isId(args[0]) && isBlockType(args[1]) && isText(args[2]);
    case 'appendImage': {
      const value = args[0] as Record<string, unknown> | undefined;
      return (
        args.length === 1 &&
        Boolean(value) &&
        isId(value!.targetId) &&
        isId(value!.markerId) &&
        isId(value!.uploadId) &&
        isText(value!.marker) &&
        (value!.container === undefined || typeof value!.container === 'boolean')
      );
    }
    case 'uploadImage': {
      const value = args[0] as Record<string, unknown> | undefined;
      return (
        args.length === 1 &&
        Boolean(value) &&
        isText(value!.url) &&
        isText(value!.type) &&
        Array.isArray(value!.bytes) &&
        value!.bytes.length > 0 &&
        value!.bytes.length <= IMAGE_LIMITS.imageBytes &&
        value!.bytes.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)
      );
    }
    default:
      return false;
  }
}

export function createNotionHandler({
  repository,
  runtime,
  fetcher,
  sleep,
}: {
  repository: Pick<ReturnType<typeof createIntegrationRepository>, 'initialize' | 'connection'>;
  runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'>;
  fetcher: NotionFetcher;
  sleep: (ms: number) => Promise<void>;
}) {
  async function execute(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
    const { integrationId, operation, args } = message;

    if (
      sender.id !== runtime.id ||
      sender.url?.split(/[?#]/)[0] !== runtime.getURL('popup.html') ||
      typeof integrationId !== 'string' ||
      !integrationId ||
      !Array.isArray(args) ||
      !validOperation(operation, args)
    ) {
      throw failure('notionSettingsError');
    }

    await repository.initialize();
    const { token } = await repository.connection(integrationId);

    if (!token) {
      throw failure('notionMissingToken');
    }

    const api = createNotionApi({ token, fetcher, sleep });
    const result = await (api[operation] as (...args: unknown[]) => Promise<unknown>)(...args);

    // Export workflows need no response bodies from write operations.
    if (operation === 'createPage') {
      const id = (result as { id?: unknown })?.id;

      if (!isId(id)) {
        throw failure('notionSaveError', { ambiguous: true });
      }

      return { id };
    }

    if (operation === 'children' || operation === 'uploadImage' || operation === 'appendImage') {
      return result;
    }
  }
  return function onMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: NotionResponse) => void
  ): true | undefined {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as Record<string, unknown>).channel !== NOTION_CHANNEL
    ) {
      return;
    }

    const command = message as Record<string, unknown>;
    void execute(command, sender).then(
      (value) => respond({ ok: true, value }),
      (caught) => {
        const error = errorDetails(caught);
        const code = notionErrorCodes.find((known) => known === error.code) ?? 'notionSaveError';
        respond({
          ok: false,
          code,
          status: typeof error.status === 'number' ? error.status : undefined,
          ambiguous:
            typeof error.ambiguous === 'boolean'
              ? error.ambiguous
              : code === 'notionSaveError' && command.operation !== 'children',
          imageReason: error.imageReason === 'format' ? 'format' : undefined,
        });
      }
    );
    return true;
  };
}
