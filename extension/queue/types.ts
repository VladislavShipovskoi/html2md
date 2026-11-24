import type { ArchiveResult, Article, ImageResult, Progress } from '../../core/types.ts';
import type { ExportState } from '../../core/notion/export-state.ts';

export type TaskStatus =
  'queued' | 'running' | 'waiting_credentials' | 'needs_review' | 'completed' | 'failed';
export interface TaskProgress {
  stage: Progress['stage'] | 'prepare' | 'save';
  completed: number;
  total: number;
}
export interface TaskResult {
  failedCount: number;
  pageId?: string;
  downloadId?: number;
}
export interface TaskError {
  code: string;
  retryable: boolean;
}
export interface ArticleSnapshot {
  readonly article: Readonly<Article>;
  readonly title: string;
  readonly tabId: number;
  readonly documentId: string;
  readonly locale: 'en' | 'ru';
  readonly options: Readonly<{ sourceLabel: string }>;
}
export interface TaskIntegration {
  readonly id: string;
  readonly name: string;
  readonly parentId: string;
}
type ExportDestination = { type: 'archive' } | { type: 'notion'; integration: TaskIntegration };
export type NewExportTask = ExportDestination & {
  commandId: string;
  snapshot: ArticleSnapshot;
};
export type ExportTask = ExportDestination & {
  id: string;
  title: string;
  status: TaskStatus;
  order: number;
  createdAt: number;
  updatedAt: number;
  attemptId?: string;
  progress?: TaskProgress;
  result?: TaskResult;
  error?: TaskError;
};
export type TaskCheckpoint =
  | { type: 'notion'; state: ExportState }
  | {
      type: 'archive';
      images?: ImageResult[];
      archive?: ArchiveResult;
      download?: { phase: 'starting' | 'started'; url: string; id?: number };
    };
export interface TaskPayload {
  snapshot: ArticleSnapshot;
  checkpoint?: TaskCheckpoint;
}
export interface TaskUpdate {
  status?: Exclude<TaskStatus, 'queued'>;
  progress?: TaskProgress;
  result?: TaskResult;
  error?: TaskError;
}
