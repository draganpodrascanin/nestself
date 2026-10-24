import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeCallSessionController } from '../testing/fake-controller';
import { VIDEO_STORAGE_KEYS, createLocalPreferenceStore } from '../preferences';
import { PreJoinCheck } from './PreJoinCheck';

afterEach(() => {
  window.localStorage.clear();
});

describe('PreJoinCheck (D-CW-21, CALL-03, CALL-04)', () => {
  it('runs the check on mount and enables Join once it succeeds', async () => {
    const user = userEvent.setup();
    const controller = new FakeCallSessionController({ delayMs: 50 });
    const check = vi.spyOn(controller, 'checkReadiness');
    const onJoin = vi.fn();
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={onJoin} />);
    expect(check).toHaveBeenCalledOnce();
    // The check starts synchronously on mount.
    expect(screen.getByText(t('prejoin.checkingDevices'))).toBeInTheDocument();
    const join = screen.getByRole('button', { name: t('prejoin.joinNow') });
    expect(join).toBeDisabled();

    await waitFor(() => expect(join).toBeEnabled(), { timeout: 3000 });
    expect(screen.getAllByText(t('prejoin.status.passed'))).toHaveLength(2);
    expect(screen.getByText(t('prejoin.networkStatus.good'))).toBeInTheDocument();
    await user.click(join);
    expect(onJoin).toHaveBeenCalledOnce();
  });

  it('shows browser help with a link when the browser blocked the microphone, and keeps Join disabled', async () => {
    const user = userEvent.setup();
    const controller = new FakeCallSessionController({ readiness: { microphone: 'denied' } });
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} browser="chrome" />);
    const help = await screen.findByRole('region', { name: t('prejoin.permissionDeniedTitle') });
    expect(within(help).getByText(t('prejoin.permissionDenied.chrome'))).toBeInTheDocument();
    const link = within(help).getByRole('link', { name: new RegExp(t('prejoin.permissionHelpLink')) });
    expect(link).toHaveAttribute('href', 'https://support.google.com/chrome/answer/2693767');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('button', { name: t('prejoin.joinNow') })).toBeDisabled();
    expect(screen.getByText(t('prejoin.microphoneRequired'))).toBeInTheDocument();

    const check = vi.spyOn(controller, 'checkReadiness');
    await user.click(within(help).getByRole('button', { name: t('prejoin.checkAgain') }));
    expect(check).toHaveBeenCalledOnce();
  });

  it('uses the generic help for browsers without specific instructions, and an app help page when given', async () => {
    const controller = new FakeCallSessionController({ readiness: { camera: 'denied' } });
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} browser="other" permissionHelpHref="/help/camera" />);
    const help = await screen.findByRole('region', { name: t('prejoin.permissionDeniedTitle') });
    expect(within(help).getByText(t('prejoin.permissionHelp'))).toBeInTheDocument();
    expect(within(help).getByRole('link', { name: new RegExp(t('prejoin.permissionHelpLink')) })).toHaveAttribute('href', '/help/camera');
    // A blocked camera alone does not block joining: the person joins with the camera off.
    await waitFor(() => expect(screen.getByRole('button', { name: t('prejoin.joinNow') })).toBeEnabled());
  });

  it('remembers the chosen camera and the camera-off choice in localStorage', async () => {
    const user = userEvent.setup();
    const controller = new FakeCallSessionController({ store: createLocalPreferenceStore() });
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: t('prejoin.joinNow') })).toBeEnabled());

    await user.click(screen.getByRole('combobox', { name: t('prejoin.camera') }));
    await user.click(await screen.findByRole('option', { name: 'USB camera (sample)' }));
    await waitFor(() => expect(window.localStorage.getItem(VIDEO_STORAGE_KEYS.camera)).toBe('sample-camera-2'));

    await user.click(screen.getByRole('switch', { name: t('prejoin.cameraOff') }));
    expect(window.localStorage.getItem(VIDEO_STORAGE_KEYS.cameraOff)).toBe('true');
    expect(await screen.findByText(t('prejoin.previewOff'))).toBeInTheDocument();
  });

  it('turns blur into a disabled option with an explanation where the browser cannot run it', async () => {
    const user = userEvent.setup();
    const controller = new FakeCallSessionController({ blurSupported: false });
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: t('prejoin.joinNow') })).toBeEnabled());
    await user.click(screen.getByRole('switch', { name: t('prejoin.blur') }));
    expect(await screen.findByText(t('prejoin.blurUnavailable'))).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: t('prejoin.blur') })).toHaveAttribute('aria-disabled', 'true');
  });

  it('plays a test sound and asks whether it was heard', async () => {
    const user = userEvent.setup();
    const controller = new FakeCallSessionController();
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} />);
    await user.click(await screen.findByRole('button', { name: t('prejoin.speakerTest') }));
    expect(await screen.findByText(t('prejoin.speakerQuestion'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('prejoin.speakerYes') }));
    expect(await screen.findByText(t('prejoin.speakerHeard'))).toBeInTheDocument();
  });

  it('shows no camera preview or camera toggle to a webinar attendee (D-CW-35)', async () => {
    const controller = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: t('prejoin.joinNow') })).toBeEnabled());
    expect(screen.queryByLabelText(t('prejoin.previewLabel'))).toBeNull();
    expect(screen.queryByRole('switch', { name: t('prejoin.cameraOff') })).toBeNull();
    expect(screen.queryByRole('switch', { name: t('prejoin.blur') })).toBeNull();
    expect(screen.queryByRole('combobox', { name: t('prejoin.camera') })).toBeNull();
  });

  it('renders the join error it is given and animates in', async () => {
    const controller = new FakeCallSessionController();
    renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} error={t('errors.joinWindowClosed')} />);
    expect(screen.getByRole('alert')).toHaveTextContent(t('errors.joinWindowClosed'));
    const panel = screen.getByRole('region', { name: t('prejoin.title') });
    expect(panel.style.transform).toMatch(/translate3d|none/);
  });

  it('passes axe', async () => {
    const controller = new FakeCallSessionController();
    const { container } = renderWithI18n(<PreJoinCheck controller={controller} onJoin={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: t('prejoin.joinNow') })).toBeEnabled());
    await expectNoA11yViolations(container);
  });
});
