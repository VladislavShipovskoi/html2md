import { failure } from '../../core/errors.ts';
import type { Integration, IntegrationInput } from '../shared/types.ts';

export const INTEGRATION_CHANNEL = 'html2md-integrations';
export const integrationErrorCodes = [
  'notionSettingsError',
  'integrationNotFound',
  'integrationNameRequired',
  'notionInvalidParent',
  'notionMissingToken',
] as const;
export type IntegrationErrorCode = (typeof integrationErrorCodes)[number];
export type IntegrationCommand = { channel: typeof INTEGRATION_CHANNEL } & (
  | { type: 'initialize' | 'list' }
  | { type: 'save'; input: IntegrationInput }
  | { type: 'remove' | 'forget'; id: string }
);
export type IntegrationResponse =
  { ok: true; value?: Integration[] | string } | { ok: false; code: IntegrationErrorCode };
export interface IntegrationService {
  initialize(): Promise<void>;
  list(): Promise<Integration[]>;
  save(input: IntegrationInput): Promise<string>;
  remove(id: string): Promise<void>;
  forgetToken(id: string): Promise<void>;
}
export interface IntegrationTransport {
  sendMessage(message: IntegrationCommand): Promise<IntegrationResponse>;
}

export function createIntegrationClient(transport: IntegrationTransport): IntegrationService {
  async function request<T>(command: IntegrationCommand): Promise<T> {
    let response: IntegrationResponse;
    try {
      response = await transport.sendMessage(command);
    } catch {
      throw failure('notionSettingsError');
    }

    if (!response?.ok) {
      const code = response?.ok === false ? response.code : undefined;
      throw failure(code && integrationErrorCodes.includes(code) ? code : 'notionSettingsError');
    }

    return response.value as T;
  }
  return {
    initialize: () => request({ channel: INTEGRATION_CHANNEL, type: 'initialize' }),
    list: () => request({ channel: INTEGRATION_CHANNEL, type: 'list' }),
    save: (input) => request({ channel: INTEGRATION_CHANNEL, type: 'save', input }),
    remove: (id) => request({ channel: INTEGRATION_CHANNEL, type: 'remove', id }),
    forgetToken: (id) => request({ channel: INTEGRATION_CHANNEL, type: 'forget', id }),
  };
}
