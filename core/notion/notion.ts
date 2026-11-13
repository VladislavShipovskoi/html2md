import type { ImageResult } from '../types.ts';
import type { NotionApi, NotionBlock, NotionFetcher, RequestOptions } from './types.ts';
import { failure } from '../errors.ts';
import { notionPageId } from './notion-page.ts';
export { notionPageId } from './notion-page.ts';

export async function notionRequest(
  token: string,
  path: string,
  body: unknown,
  fetcher: NotionFetcher,
  options: RequestOptions = {}
) {
  const multipart = body instanceof FormData;
  const method = options.method ?? (path.endsWith('/markdown') ? 'PATCH' : 'POST');
  const sleep = options.sleep;

  for (let attempt = 0; ; attempt++) {
    let response;
    let result;
    try {
      response = await fetcher(`https://api.notion.com/v1/${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'Notion-Version': '2026-03-11',
          ...(multipart ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: multipart ? body : JSON.stringify(body) }),
        signal: AbortSignal.timeout(60000),
        redirect: 'error',
      });
      result = await response.json();
    } catch {
      throw Object.assign(failure('notionSaveError'), { ambiguous: method !== 'GET' });
    }

    if (
      [429, 529].includes(response.status ?? 0) &&
      result.additional_data?.rate_limit_reason !== 'public_api_request_blocked' &&
      attempt < 3
    ) {
      const retry = response.headers?.get('retry-after');
      const seconds =
        retry !== null && retry !== undefined && Number.isFinite(Number(retry))
          ? Math.max(0, Number(retry))
          : 2 ** attempt;
      await sleep!(seconds * 1000);
      continue;
    }

    if (!response.ok) {
      const committedId = result.additional_data?.committed_resource_id;

      if (
        response.status === 503 &&
        path === 'pages' &&
        /^[a-f0-9-]{32,36}$/i.test(committedId ?? '')
      ) {
        return { id: committedId };
      }

      const keys: Record<number, string> = {
        401: 'notionUnauthorized',
        403: 'notionForbidden',
        404: 'notionNotFound',
        429: 'notionRateLimited',
        529: 'notionRateLimited',
      };

      throw Object.assign(failure(keys[response.status ?? 0] ?? 'notionSaveError'), {
        status: response.status,
        ambiguous: (response.status ?? 0) >= 500 && response.status !== 529,
      });
    }

    return result;
  }
}

export async function uploadNotionImage(
  token: string,
  image: ImageResult,
  fetcher: NotionFetcher,
  options: RequestOptions = {}
): Promise<string> {
  const extensions: Record<string, string> = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/heic': 'heic',
    'image/tiff': 'tiff',
    'image/vnd.microsoft.icon': 'ico',
    'image/bmp': 'bmp',
    'image/avif': 'avif',
    'image/apng': 'apng',
  };
  const extension = extensions[image.type ?? ''];

  if (!extension) {
    throw Object.assign(failure('notionImageFormat'), { imageReason: 'format' });
  }

  const filename = `image.${extension}`;
  const upload = await notionRequest(
    token,
    'file_uploads',
    { mode: 'single_part', filename, content_type: image.type },
    fetcher,
    options
  );
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(image.bytes!)], { type: image.type }), filename);
  const sent = await notionRequest(token, `file_uploads/${upload.id}/send`, form, fetcher, options);

  if (sent.status !== 'uploaded') {
    throw failure('notionSaveError');
  }

  return upload.id;
}

export async function notionChildren(
  token: string,
  blockId: string,
  fetcher: NotionFetcher,
  options: RequestOptions = {}
): Promise<NotionBlock[]> {
  const blocks = [];
  let cursor;
  do {
    const query = cursor ? `?start_cursor=${encodeURIComponent(cursor)}` : '';
    const result = await notionRequest(
      token,
      `blocks/${blockId}/children${query}`,
      undefined,
      fetcher,
      { ...options, method: 'GET' }
    );
    blocks.push(...result.results);
    cursor = result.has_more ? result.next_cursor : undefined;
  } while (cursor);
  return blocks;
}

export async function createNotionPage(
  token: string,
  parentId: string,
  title: string,
  fetcher: NotionFetcher,
  options: RequestOptions = {}
) {
  return notionRequest(
    token,
    'pages',
    {
      parent: { type: 'page_id', page_id: notionPageId(parentId) },
      properties: {
        title: {
          type: 'title',
          title: [{ type: 'text', text: { content: title.slice(0, 2000) } }],
        },
      },
    },
    fetcher,
    options
  );
}

export async function writeNotionMarkdown(
  token: string,
  pageId: string,
  markdown: string,
  fetcher: NotionFetcher,
  options: RequestOptions = {}
) {
  return notionRequest(
    token,
    `pages/${pageId}/markdown`,
    {
      type: 'replace_content',
      replace_content: { new_str: markdown },
    },
    fetcher,
    options
  );
}

const rich = (text: string, bold = false) =>
  Array.from({ length: Math.ceil(text.length / 2000) }, (_, index) => ({
    type: 'text',
    text: { content: text.slice(index * 2000, (index + 1) * 2000) },
    annotations: { bold },
  }));
/** Bind credentials at the infrastructure boundary, outside the export workflow. */

export function createNotionApi({
  token,
  fetcher,
  sleep,
}: {
  token: string;
  fetcher: NotionFetcher;
  sleep: (ms: number) => Promise<void>;
}): NotionApi {
  if (typeof fetcher !== 'function' || typeof sleep !== 'function') {
    throw new TypeError('createNotionApi requires fetcher and sleep functions');
  }

  const request = (path: string, body: unknown, options: RequestOptions = {}) =>
    notionRequest(token, path, body, fetcher, { ...options, sleep });
  const patch = (id: string, body: unknown) => request(`blocks/${id}`, body, { method: 'PATCH' });
  return {
    createPage: (parentId, title) => createNotionPage(token, parentId, title, fetcher, { sleep }),
    writeMarkdown: (pageId, markdown) =>
      writeNotionMarkdown(token, pageId, markdown, fetcher, { sleep }),
    children: (id) => notionChildren(token, id, fetcher, { sleep }),
    uploadImage: (image) => uploadNotionImage(token, image, fetcher, { sleep }),
    async appendImage({ targetId, markerId, uploadId, marker, container }) {
      const result = await request(
        `blocks/${targetId}/children`,
        {
          children: [
            {
              object: 'block',
              type: 'image',
              image: { type: 'file_upload', file_upload: { id: uploadId }, caption: rich(marker) },
            },
          ],
          position: container
            ? { type: 'start' }
            : { type: 'after_block', after_block: { id: markerId } },
        },
        { method: 'PATCH' }
      );
      return result.results?.[0]?.id;
    },
    setCaption: (id, alt) => patch(id, { image: { caption: rich(alt.slice(0, 2000)) } }),
    clearMarker: (id, type) => patch(id, { [type]: { rich_text: [] } }),
    removeBlock: (id) => request(`blocks/${id}`, undefined, { method: 'DELETE' }),
    writeImageError: (id, type, text) => patch(id, { [type]: { rich_text: rich(text, true) } }),
  };
}
