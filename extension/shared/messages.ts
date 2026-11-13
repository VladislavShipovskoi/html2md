import { errorDetails } from '../../core/errors.ts';
import type { ImageError, Progress } from '../../core/types.ts';
import type { Translate } from './types.ts';

const reasons: Record<string, string> = {
  http: 'imageHttp',
  network: 'imageNetwork',
  tabAccess: 'imageTabAccess',
  timeout: 'imageTimeout',
  format: 'imageFormat',
  size: 'imageSize',
  totalSize: 'imageTotalSize',
  empty: 'imageEmpty',
  location: 'imageLocation',
  upload: 'imageUpload',
};

export function createMessageFormatter(t: Translate) {
  return {
    imageError: ({ reason, status }: ImageError) =>
      t('notionImageError', t(reasons[reason] ?? 'imageUpload', String(status ?? ''))),
    progress: ({ stage, completed, total }: Progress) =>
      t(
        {
          download: 'notionDownloadingImages',
          upload: 'notionUploadingImages',
          finish: 'notionFinishingImages',
        }[stage],
        [String(completed), String(total)]
      ),
    error: (caught: unknown, fallback = 'notionSaveError') => {
      const error = errorDetails(caught);
      return t(
        [
          'notionUnauthorized',
          'notionForbidden',
          'notionNotFound',
          'notionRateLimited',
          'notionSaveError',
          'notionSettingsError',
          'notionInvalidParent',
          'notionMissingToken',
          'integrationNameRequired',
          'integrationNotFound',
          'notionImageUncertain',
        ].includes(error.code ?? error.message ?? '')
          ? (error.code ?? error.message)!
          : fallback
      );
    },
  };
}
