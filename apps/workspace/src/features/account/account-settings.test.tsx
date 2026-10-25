import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccountSettings } from './account-settings';
import { apiError, makeAccountApi, makeAuth, renderAccount, t, testI18n } from './account-test-harness';

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await testI18n.changeLanguage('en');
});

const nameInput = () => screen.getByRole('textbox', { name: new RegExp(t('auth:account.displayName.label')) });
const saveButton = () => screen.getByRole('button', { name: t('auth:account.displayName.save') });

describe('AccountSettings: display name', () => {
  it('saves the trimmed name and reloads the principal', async () => {
    const user = userEvent.setup();
    const authApi = makeAccountApi();
    const auth = makeAuth();
    renderAccount(<AccountSettings authApi={authApi} sampleMode={false} />, auth);
    await user.clear(await screen.findByRole('textbox'));
    await user.type(nameInput(), '  Jovana P.  ');
    await user.click(saveButton());
    await waitFor(() => expect(authApi.updateDisplayName).toHaveBeenCalledWith('Jovana P.'));
    expect(auth.refreshPrincipal).toHaveBeenCalled();
    expect(await screen.findByText(t('auth:account.displayName.saved'))).toBeInTheDocument();
  });

  it('asks for a name when the field is empty and does not call the API', async () => {
    const user = userEvent.setup();
    const authApi = makeAccountApi();
    renderAccount(<AccountSettings authApi={authApi} sampleMode={false} />);
    await user.clear(await screen.findByRole('textbox'));
    await user.click(saveButton());
    expect((await screen.findAllByText(t('auth:account.displayName.required'))).length).toBeGreaterThan(0);
    expect(authApi.updateDisplayName).not.toHaveBeenCalled();
  });

  it('rejects names over 120 characters', async () => {
    const user = userEvent.setup();
    const authApi = makeAccountApi();
    renderAccount(<AccountSettings authApi={authApi} sampleMode={false} />);
    const input = await screen.findByRole('textbox');
    await user.clear(input);
    await user.click(input);
    await user.paste('x'.repeat(121));
    await user.click(saveButton());
    expect((await screen.findAllByText(t('auth:account.displayName.tooLong'))).length).toBeGreaterThan(0);
    expect(authApi.updateDisplayName).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(400, 'validation'), 'auth:account.errors.validation'],
    [apiError(429, 'rate_limited'), 'auth:account.errors.rateLimited'],
    [apiError(0, 'network'), 'auth:error.network'],
    [apiError(500, 'boom'), 'auth:error.unknown'],
  ])('shows translated copy when saving fails (%o)', async (error, key) => {
    const user = userEvent.setup();
    const authApi = makeAccountApi({ updateDisplayName: vi.fn().mockRejectedValue(error) });
    renderAccount(<AccountSettings authApi={authApi} sampleMode={false} />);
    await user.click(await screen.findByRole('button', { name: t('auth:account.displayName.save') }));
    expect((await screen.findAllByText(t(key))).length).toBeGreaterThan(0);
    expect(screen.queryByText((content) => content.startsWith('English '))).not.toBeInTheDocument();
  });

  it('is disabled with the sample note in sample mode', async () => {
    renderAccount(<AccountSettings authApi={makeAccountApi()} sampleMode />);
    expect(await screen.findByText(t('auth:account.sampleNote'))).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
    expect(saveButton()).toBeDisabled();
  });
});

describe('AccountSettings: language', () => {
  async function chooseHungarian(user: ReturnType<typeof userEvent.setup>) {
    await user.click(await screen.findByRole('combobox', { name: t('auth:account.locale.label') }));
    await user.click(await screen.findByRole('option', { name: 'Magyar' }));
  }

  it('persists the locale on the account, then switches the UI', async () => {
    const user = userEvent.setup();
    const authApi = makeAccountApi();
    renderAccount(<AccountSettings authApi={authApi} sampleMode={false} />);
    await chooseHungarian(user);
    await waitFor(() => expect(authApi.updateLocale).toHaveBeenCalledWith('hu'));
    await waitFor(() => expect(testI18n.language).toBe('hu'));
  });

  it.each([
    [apiError(503, 'unavailable'), 'auth:error.unavailable'],
    [apiError(400, 'validation'), 'auth:account.errors.validation'],
    [apiError(418, 'teapot'), 'auth:error.unknown'],
  ])('keeps the language and shows translated copy when saving fails (%o)', async (error, key) => {
    const user = userEvent.setup();
    const authApi = makeAccountApi({ updateLocale: vi.fn().mockRejectedValue(error) });
    renderAccount(<AccountSettings authApi={authApi} sampleMode={false} />);
    await chooseHungarian(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(t(key));
    expect(testI18n.language).toBe('en');
  });

  it('changes the language locally in sample mode without calling the API', async () => {
    const user = userEvent.setup();
    const authApi = makeAccountApi();
    renderAccount(<AccountSettings authApi={authApi} sampleMode />);
    await chooseHungarian(user);
    await waitFor(() => expect(testI18n.language).toBe('hu'));
    expect(authApi.updateLocale).not.toHaveBeenCalled();
  });
});
