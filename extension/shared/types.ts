export type Translate = (key: string, substitutions?: string | string[]) => string;
export type { ImageDownloader } from '../../core/types.ts';
export interface Integration {
  id: string;
  type: string;
  name: string;
  parentId: string;
  connected?: boolean;
}
export interface IntegrationInput {
  id?: string;
  name: string;
  parentId: string;
  token: string;
}
export type StorageData = Record<string, any>;
export interface StorageArea {
  get(keys?: string | string[] | null): Promise<StorageData>;
  set(values: StorageData): Promise<void>;
  remove(key: string): Promise<void>;
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
}
export interface IntegrationStorage {
  local: StorageArea;
  session: StorageArea;
}
export interface Locks {
  request<T>(name: string, action: () => Promise<T>): Promise<T>;
}
export type ThemeChangeListener = (
  changes: Record<string, { newValue?: unknown }>,
  area: string
) => void;
export interface ThemeStorage {
  local: Pick<StorageArea, 'get' | 'set'>;
  onChanged?: {
    addListener(listener: ThemeChangeListener): void;
    removeListener(listener: ThemeChangeListener): void;
  };
}
