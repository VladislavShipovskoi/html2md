import { errorDetails } from '../errors.ts';
import type { NotionApi, NotionBlock, BlockContent, NotionExportOptions } from './types.ts';
import type { ExportState, ImageOccurrence } from './export-state.ts';
import { failure } from '../errors.ts';
const blockText = (block: NotionBlock): string =>
  ((block[block.type] as BlockContent)?.rich_text ?? block.image?.caption ?? [])
    .map((item) => item.plain_text ?? item.text?.content ?? '')
    .join('');
const fatal = (error: unknown) => [401, 403, 404].includes(errorDetails(error).status ?? 0);

async function findMarkers(api: NotionApi, pageId: string, state: ExportState) {
  const wanted = new Map(
    state.occurrences
      .filter((item) => item.status !== 'complete' && !item.blockId)
      .map((item) => [item.marker, item])
  );
  async function visit(parentId: string): Promise<void> {
    const children = await api.children(parentId);

    for (const block of children) {
      const item = wanted.get(blockText(block));

      if (
        item &&
        [
          'paragraph',
          'bulleted_list_item',
          'numbered_list_item',
          'quote',
          'heading_1',
          'heading_2',
          'heading_3',
        ].includes(block.type)
      ) {
        item.blockId = block.id;
        item.blockType = block.type;
        item.container =
          Boolean(block.has_children) ||
          ['bulleted_list_item', 'numbered_list_item', 'quote'].includes(block.type);
        item.parentId = parentId;
        wanted.delete(item.marker);
      }

      if (block.has_children && wanted.size) {
        await visit(block.id);
      }
    }
  }
  await visit(pageId);

  if (wanted.size) {
    throw failure('notionImageUncertain');
  }
}

async function attachImage(api: NotionApi, item: ImageOccurrence, uploadId: string): Promise<void> {
  const targetId = (item.container ? item.blockId : item.parentId)!;

  if (item.insertion === 'uncertain') {
    const children = await api.children(targetId);
    const index = item.container ? -1 : children.findIndex((block) => block.id === item.blockId);
    const next = children[index + 1];

    if (
      (!item.container && index < 0) ||
      next?.type !== 'image' ||
      blockText(next) !== item.marker
    ) {
      throw failure('notionImageUncertain');
    }

    item.insertedId = next.id;
    item.insertion = 'confirmed';
  }

  if (!item.insertedId) {
    try {
      item.insertedId = await api.appendImage({
        targetId,
        markerId: item.blockId!,
        uploadId,
        marker: item.marker,
        container: item.container,
      });
      item.insertion = 'confirmed';

      if (!item.insertedId) {
        throw Object.assign(failure('notionImageUncertain'), { ambiguous: true });
      }
    } catch (caught) {
      const error = errorDetails(caught);

      if (error.ambiguous) {
        item.insertion = 'uncertain';
        return attachImage(api, item, uploadId);
      }

      throw error;
    }
  }

  await api.setCaption(item.insertedId, item.alt);

  if (item.container) {
    await api.clearMarker(item.blockId!, item.blockType!);
  } else {
    if (item.cleanup === 'uncertain') {
      const children = await api.children(item.parentId!);

      if (!children.some((block) => block.id === item.blockId)) {
        return;
      }
    }

    try {
      await api.removeBlock(item.blockId!);
    } catch (caught) {
      const error = errorDetails(caught);
      item.cleanup = 'uncertain';
      throw error;
    }
  }
}

export async function exportNotionArticle({
  state,
  api,
  parentId,
  title,
  downloadImages,
  formatImageError,
  progress = () => {},
  onPage = () => {},
}: NotionExportOptions) {
  if (state.creation === 'uncertain') {
    throw failure('notionImageUncertain');
  }

  if (!state.page) {
    try {
      state.page = await api.createPage(parentId, title);
      state.creation = 'confirmed';
    } catch (caught) {
      const error = errorDetails(caught);
      state.creation = error.ambiguous ? 'uncertain' : 'pending';
      throw error;
    }
  }

  onPage(state.page);

  if (state.downloading !== 'confirmed') {
    const urls = [...new Set(state.occurrences.map((item) => item.url))];
    const images = await downloadImages(urls, (count) =>
      progress({ stage: 'download', completed: count, total: urls.length })
    );

    for (const url of urls) {
      const image = images.find((item) => item.url === url) ?? {
        url,
        failed: true,
        reason: 'network',
      };
      state.assets.set(url, { image });
    }

    state.downloading = 'confirmed';
  }

  if (state.writing !== 'confirmed') {
    if (state.writing === 'uncertain') {
      if (!state.occurrences.length) {
        throw failure('notionImageUncertain');
      }

      await findMarkers(api, state.page.id, state);
    } else {
      try {
        await api.writeMarkdown(state.page.id, state.markdown);
      } catch (caught) {
        const error = errorDetails(caught);
        state.writing = error.ambiguous ? 'uncertain' : 'pending';
        throw error;
      }
    }

    state.writing = 'confirmed';
  }

  if (!state.occurrences.length) {
    return state;
  }

  await findMarkers(api, state.page.id, state);
  let count = 0;

  for (const asset of state.assets.values()) {
    progress({ stage: 'upload', completed: count, total: state.assets.size });

    if (!asset.uploadId && !asset.error) {
      if (asset.image.failed) {
        asset.error = { reason: asset.image.reason ?? 'network', status: asset.image.status };
      } else {
        try {
          asset.uploadId = await api.uploadImage(asset.image);
        } catch (caught) {
          const error = errorDetails(caught);

          if (fatal(error)) {
            throw error;
          }

          asset.error = { reason: error.imageReason ?? 'upload' };
        }
      }
    }

    count++;
    progress({ stage: 'upload', completed: count, total: state.assets.size });
  }

  progress({ stage: 'finish', completed: 0, total: 0 });

  for (const item of state.occurrences) {
    if (item.status === 'complete') {
      continue;
    }

    const asset = state.assets.get(item.url)!;

    if (!asset.error && !item.error) {
      try {
        await attachImage(api, item, asset.uploadId!);
      } catch (caught) {
        const error = errorDetails(caught);

        if (
          error.ambiguous ||
          item.insertion === 'uncertain' ||
          item.insertedId ||
          fatal(error) ||
          error.message === 'notionImageUncertain'
        ) {
          throw error;
        }

        item.error = { reason: error.status === 400 ? 'location' : 'upload' };
      }
    }

    if (asset.error || item.error) {
      await api.writeImageError(
        item.blockId!,
        item.blockType!,
        formatImageError((asset.error ?? item.error)!)
      );
      state.failedCount++;
    }

    item.cleanup = 'confirmed';
    item.status = 'complete';
  }

  return state;
}
