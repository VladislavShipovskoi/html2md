export interface Article {
  title: string;
  content: string;
  url: string;
  baseUrl: string;
  characters?: number;
}
export type PageAnalysis =
  { supported: false } | (Article & { supported: true; articleFound: boolean; characters: number });
export interface ImageError {
  reason: string;
  status?: number;
}
export interface ImageResult {
  url: string;
  type?: string;
  bytes?: number[] | Uint8Array;
  failed?: boolean;
  reason?: string;
  status?: number;
  transferredBytes?: number;
}
export interface ArchiveResult {
  bytes: Uint8Array;
  filename: string;
  failedCount: number;
}
export interface Progress {
  stage: 'download' | 'upload' | 'finish';
  completed: number;
  total: number;
}
export type ProgressCallback = (event: Progress) => void;
export type ImageDownloader = (
  urls: string[],
  progress?: (completed: number) => void
) => Promise<ImageResult[]>;
export type ImageErrorFormatter = (error: ImageError) => string;
export type Fetcher = typeof globalThis.fetch;
export interface ImageFetchOptions {
  fetcher: Fetcher;
  maxTotalBytes?: number;
  credentials?: RequestCredentials;
  fallback?: (url: string) => Promise<Pick<ImageResult, 'type' | 'bytes'> | undefined>;
  progress?: ProgressCallback;
}
export interface ArchiveOptions {
  article: Article;
  document: Document;
  sourceLabel: string;
  downloadImages: ImageDownloader;
  progress?: (completed: number) => void;
}
