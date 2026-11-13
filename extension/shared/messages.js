const reasons = {
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

export function createMessageFormatter(t) {
  return {
    imageError: ({ reason, status }) =>
      t('notionImageError', t(reasons[reason] ?? 'imageUpload', String(status ?? ''))),
    progress: ({ stage, completed, total }) =>
      t(
        {
          download: 'notionDownloadingImages',
          upload: 'notionUploadingImages',
          finish: 'notionFinishingImages',
        }[stage],
        [String(completed), String(total)]
      ),
    error: (error, fallback = 'notionSaveError') =>
      t(
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
        ].includes(error.code ?? error.message)
          ? (error.code ?? error.message)
          : fallback
      ),
  };
}
