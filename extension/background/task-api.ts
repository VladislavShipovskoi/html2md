import { errorDetails, failure } from '../../core/errors.ts';
import { createNotionApi } from '../../core/notion/index.ts';
import type { NotionApi, NotionFetcher } from '../../core/notion/types.ts';
import type { createIntegrationRepository } from '../integrations/integrations.ts';

export function createTaskApi(
  repository: ReturnType<typeof createIntegrationRepository>,
  integrationId: string,
  fetcher: NotionFetcher,
  sleep: (ms: number) => Promise<void>
): NotionApi {
  async function invoke<K extends keyof NotionApi>(
    operation: K,
    args: Parameters<NotionApi[K]>
  ): Promise<Awaited<ReturnType<NotionApi[K]>>> {
    // Re-read credentials for every operation so forgetting a token stops subsequent requests.
    const { token } = await repository.connection(integrationId);

    if (!token) {
      throw failure('notionMissingToken');
    }

    const api = createNotionApi({ token, fetcher, sleep });
    try {
      return await (
        api[operation] as (
          ...args: Parameters<NotionApi[K]>
        ) => Promise<Awaited<ReturnType<NotionApi[K]>>>
      )(...args);
    } catch (error) {
      if (errorDetails(error).status === 401) {
        const current = await repository.connection(integrationId);

        if (current.token && current.token !== token) {
          throw failure('notionMissingToken');
        }
      }

      throw error;
    }
  }
  return {
    createPage: (...args) => invoke('createPage', args),
    writeMarkdown: (...args) => invoke('writeMarkdown', args),
    children: (...args) => invoke('children', args),
    uploadImage: (...args) => invoke('uploadImage', args),
    appendImage: (...args) => invoke('appendImage', args),
    setCaption: (...args) => invoke('setCaption', args),
    clearMarker: (...args) => invoke('clearMarker', args),
    removeBlock: (...args) => invoke('removeBlock', args),
    writeImageError: (...args) => invoke('writeImageError', args),
  };
}
