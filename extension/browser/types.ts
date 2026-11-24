import type { PageAnalysis, ImageResult } from '../../core/types.ts';
import type { ThemeStorage, Translate } from '../shared/types.ts';
import type { IntegrationTransport } from '../integrations/commands.ts';
import type { QueueTransport } from '../queue/commands.ts';
import type { ActiveSourceHost } from './active-source.ts';
export interface Tab {
  id?: number;
  url?: string;
  title?: string;
}
export type ScriptRequest = {
  target: { tabId: number; documentIds?: string[] };
  world?: 'MAIN';
} & (
  | { files: string[]; func?: never; args?: never }
  | {
      files?: never;
      func: (urls: string[], maxTotalBytes: number) => Promise<ImageResult[]>;
      args: [string[], number];
    }
);
export interface ChromeHost {
  runtime: { openOptionsPage(): Promise<void> };
  tabs: {
    query(options: { active: boolean; currentWindow?: boolean; windowId?: number }): Promise<Tab[]>;
  };
  scripting: {
    executeScript(request: ScriptRequest): Promise<{ result?: unknown; documentId?: string }[]>;
  };
  downloads: {
    download(options: {
      url: string;
      filename: string;
      conflictAction: 'uniquify';
    }): Promise<number>;
  };
}
export interface BrowserOptions {
  chrome: ChromeHost;
  clipboard: Pick<Clipboard, 'writeText'>;
  URL: typeof URL;
  Blob: typeof Blob;
  setTimeout: (callback: () => void, delay: number) => unknown;
}
export interface RuntimeEnvironment extends Omit<BrowserOptions, 'clipboard'> {
  document: Document;
  chrome: ChromeHost & {
    runtime: ChromeHost['runtime'] &
      IntegrationTransport &
      QueueTransport &
      ActiveSourceHost['runtime'];
    windows: ActiveSourceHost['windows'];
    permissions?: typeof chrome.permissions;
    tabs: ChromeHost['tabs'] & ActiveSourceHost['tabs'];
    i18n: { getMessage: Translate };
    storage: ThemeStorage;
  };
  navigator: { clipboard: Pick<Clipboard, 'writeText'> };
  crypto: Pick<Crypto, 'randomUUID'>;
}
export type AnalyzedPage = Extract<PageAnalysis, { supported: true }>;
