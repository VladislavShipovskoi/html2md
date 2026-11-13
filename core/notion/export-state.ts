import type { ImageResult, ImageError } from '../types.ts';
export type StepStatus = 'pending' | 'uncertain' | 'confirmed';
export interface ImageOccurrence {
  marker: string;
  url: string;
  alt: string;
  status: 'pending' | 'complete';
  insertion: StepStatus;
  cleanup: StepStatus;
  blockId?: string;
  insertedId?: string;
  blockType?: string;
  container?: boolean;
  parentId?: string;
  error?: ImageError;
}
export interface ExportState {
  markdown: string;
  occurrences: ImageOccurrence[];
  initialFailures: number;
  failedCount: number;
  assets: Map<string, { image: ImageResult; uploadId?: string; error?: ImageError }>;
  creation: StepStatus;
  writing: StepStatus;
  downloading: StepStatus;
  page?: { id: string };
}
export function createExportState({
  markdown,
  occurrences,
  initialFailures,
}: Pick<ExportState, 'markdown' | 'occurrences' | 'initialFailures'>): ExportState {
  return {
    markdown,
    occurrences,
    initialFailures,
    failedCount: initialFailures,
    assets: new Map(),
    creation: 'pending',
    writing: 'pending',
    downloading: 'pending',
  };
}
