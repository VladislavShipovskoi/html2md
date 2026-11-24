import { failure } from '../../core/errors.ts';

export function createOffscreenBridge(host: Pick<typeof chrome, 'runtime' | 'offscreen'>) {
  let creating: Promise<void> | undefined;
  return async function request<T = void>(message: {
    type: 'prepare' | 'image-urls' | 'archive-url' | 'release' | 'activity';
    taskId?: string;
    attemptId?: string;
    active?: boolean;
  }): Promise<T> {
    const contexts = await host.runtime.getContexts({
      contextTypes: [host.runtime.ContextType.OFFSCREEN_DOCUMENT],
    });

    if (
      !contexts.length &&
      (message.type === 'release' || (message.type === 'activity' && !message.active))
    ) {
      return undefined as T;
    }

    if (!contexts.length) {
      creating ??= host.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [host.offscreen.Reason.DOM_PARSER, host.offscreen.Reason.BLOBS],
        justification:
          'Prepare saved article exports and retain ZIP blob URLs until Chrome finishes downloading.',
      });
      try {
        await creating;
      } finally {
        creating = undefined;
      }
    }

    const response = await host.runtime.sendMessage({ channel: 'html2md-offscreen', ...message });

    if (!response?.ok) {
      throw failure('queueStorageError');
    }

    return response.value as T;
  };
}
