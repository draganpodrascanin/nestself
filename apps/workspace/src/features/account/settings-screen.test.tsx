import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { ThemeProvider } from '@nestself/ui';
import { SettingsScreen } from './settings-screen';
import { makeAccountApi, makeAuth, passwordPrincipal, renderAccount, t } from './account-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('SettingsScreen', () => {
  it('composes Account, Security and Preferences with the privacy text', async () => {
    renderAccount(
      <ThemeProvider>
        <SettingsScreen authApi={makeAccountApi()} sampleMode={false} />
      </ThemeProvider>,
      makeAuth({ principal: passwordPrincipal(true) }),
    );
    expect(await screen.findByRole('heading', { level: 1, name: t('workspace:settings.title') })).toBeInTheDocument();
    for (const key of ['account', 'security', 'preferences']) {
      expect(screen.getByRole('heading', { level: 2, name: t(`auth:account.sections.${key}`) })).toBeInTheDocument();
    }
    expect(screen.getByRole('heading', { level: 3, name: t('auth:account.sessions.title') })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: t('auth:account.authenticator.title') })).toBeInTheDocument();
    expect(screen.getByText(t('common:privacy.pointOfUse'))).toBeInTheDocument();
  });
});
