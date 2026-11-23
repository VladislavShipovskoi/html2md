import { errorDetails, failure } from '../../core/errors.ts';
import { INTEGRATION_CHANNEL, integrationErrorCodes } from '../integrations/commands.ts';
import type { IntegrationResponse, IntegrationService } from '../integrations/commands.ts';
import type { IntegrationInput } from '../shared/types.ts';

function validInput(input: unknown): input is IntegrationInput {
  if (!input || typeof input !== 'object') {
    return false;
  }

  const value = input as Record<string, unknown>;
  return (
    ['name', 'parentId', 'token'].every((key) => typeof value[key] === 'string') &&
    (value.id === undefined || (typeof value.id === 'string' && value.id.length > 0)) &&
    (value.rememberToken === undefined || typeof value.rememberToken === 'boolean')
  );
}

export function createIntegrationHandler(
  repository: IntegrationService,
  runtime: Pick<typeof chrome.runtime, 'id' | 'getURL'>
) {
  async function execute(message: Record<string, unknown>, sender: chrome.runtime.MessageSender) {
    const url = sender.url?.split(/[?#]/)[0];
    const options = url === runtime.getURL('options.html');
    const popup = url === runtime.getURL('popup.html');

    if (sender.id !== runtime.id || (!options && !popup)) {
      throw failure('notionSettingsError');
    }

    switch (message.type) {
      case 'initialize':
        await repository.initialize();
        return;
      case 'list':
        await repository.initialize();
        return repository.list();
      case 'save':
        if (!options || !validInput(message.input)) {
          throw failure('notionSettingsError');
        }

        await repository.initialize();
        return repository.save(message.input);
      case 'remove':
      case 'forget':
        if (!options || typeof message.id !== 'string' || !message.id) {
          throw failure('notionSettingsError');
        }

        await repository.initialize();
        await (message.type === 'remove'
          ? repository.remove(message.id)
          : repository.forgetToken(message.id));
        return;
      default:
        throw failure('notionSettingsError');
    }
  }

  return function onMessage(
    message: unknown,
    sender: chrome.runtime.MessageSender,
    respond: (response: IntegrationResponse) => void
  ): true | undefined {
    if (
      !message ||
      typeof message !== 'object' ||
      (message as Record<string, unknown>).channel !== INTEGRATION_CHANNEL
    ) {
      return;
    }

    void execute(message as Record<string, unknown>, sender).then(
      (value) => respond({ ok: true, value }),
      (caught) => {
        const code = errorDetails(caught).code;
        respond({
          ok: false,
          code: integrationErrorCodes.find((known) => known === code) ?? 'notionSettingsError',
        });
      }
    );
    return true;
  };
}
