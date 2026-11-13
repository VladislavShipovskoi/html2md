import type {
  ImageResult,
  ImageDownloader,
  ImageErrorFormatter,
  ProgressCallback,
} from '../types.ts';
import type { ExportState } from './export-state.ts';
export interface RichText {
  plain_text?: string;
  text?: { content: string };
}
export interface BlockContent {
  rich_text?: RichText[];
  caption?: RichText[];
}
export interface NotionBlock {
  id: string;
  type: string;
  has_children?: boolean;
  image?: BlockContent;
  [key: string]: string | boolean | BlockContent | undefined;
}
export interface NotionApi {
  createPage(parentId: string, title: string): Promise<{ id: string }>;
  writeMarkdown(pageId: string, markdown: string): Promise<unknown>;
  children(id: string): Promise<NotionBlock[]>;
  uploadImage(image: ImageResult): Promise<string>;
  appendImage(options: {
    targetId: string;
    markerId: string;
    uploadId: string;
    marker: string;
    container?: boolean;
  }): Promise<string | undefined>;
  setCaption(id: string, alt: string): Promise<unknown>;
  clearMarker(id: string, type: string): Promise<unknown>;
  removeBlock(id: string): Promise<unknown>;
  writeImageError(id: string, type: string, text: string): Promise<unknown>;
}
export interface NotionExportOptions {
  state: ExportState;
  api: NotionApi;
  parentId: string;
  title: string;
  downloadImages: ImageDownloader;
  formatImageError: ImageErrorFormatter;
  progress?: ProgressCallback;
  onPage?: (page: { id: string }) => void;
}
export interface RequestOptions {
  method?: string;
  sleep?: (ms: number) => Promise<void>;
}
// JSON is interpreted by the API adapter; workflows consume the typed NotionApi interface.
export interface NotionResponse {
  ok: boolean;
  status?: number;
  headers?: { get(name: string): string | null };
  json(): Promise<any>;
}
export type NotionFetcher = (url: string, options?: RequestInit) => Promise<NotionResponse>;
