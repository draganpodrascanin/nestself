import { afterEach, describe, expect, it, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { ControlBar } from './ControlBar';
import type { ControlBarProps } from './ControlBar';

const originalMatchMedia = window.matchMedia;

function setWide(wide: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: wide,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

function props(overrides: Partial<ControlBarProps> = {}): ControlBarProps {
  return {
    participantRole: 'employee',
    muted: false,
    cameraOn: true,
    blur: { supported: null, enabled: false, loading: false },
    devices: {
      cameras: [
        { deviceId: 'cam-1', label: 'Built-in camera' },
        { deviceId: 'cam-2', label: '' },
      ],
      microphones: [{ deviceId: 'mic-1', label: 'Built-in microphone' }],
      speakers: [{ deviceId: 'spk-1', label: 'Speakers' }],
      selected: { camera: 'cam-1', microphone: 'mic-1', speaker: 'spk-1' },
    },
    onToggleMute: vi.fn(),
    onToggleCamera: vi.fn(),
    onToggleBlur: vi.fn(),
    onSelectDevice: vi.fn(),
    onToggleFullscreen: vi.fn(),
    onSignal: vi.fn(),
    onLeave: vi.fn(),
    ...overrides,
  };
}

describe('ControlBar (UX-22, CALL-08)', () => {
  it('fires the mute callback and announces the new state', async () => {
    const user = userEvent.setup();
    const base = props();
    const { rerender } = renderWithI18n(<ControlBar {...base} />);
    await user.click(screen.getByRole('button', { name: t('controls.mute') }));
    expect(base.onToggleMute).toHaveBeenCalledOnce();

    rerender(<ControlBar {...base} muted />);
    expect(screen.getByRole('button', { name: t('controls.unmute') })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId('control-bar-announcer')).toHaveTextContent(t('controls.announce.muted')));
    expect(screen.getByTestId('control-bar-announcer').closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');

    rerender(<ControlBar {...base} muted cameraOn={false} />);
    await waitFor(() => expect(screen.getByTestId('control-bar-announcer')).toHaveTextContent(t('controls.announce.cameraOff')));
  });

  it('opens the device menu and switches the camera', async () => {
    const user = userEvent.setup();
    const base = props();
    renderWithI18n(<ControlBar {...base} />);
    await user.click(screen.getByRole('button', { name: t('controls.devices') }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: /Built-in camera.*selected/ })).toBeInTheDocument();
    await user.click(within(menu).getByRole('menuitem', { name: new RegExp(t('prejoin.cameraFallback', { index: 2 })) }));
    expect(base.onSelectDevice).toHaveBeenCalledWith('camera', 'cam-2');
  });

  it('collapses secondary controls into an overflow menu at mobile width, which animates out', async () => {
    setWide(false);
    const user = userEvent.setup();
    const base = props();
    renderWithI18n(<ControlBar {...base} />);
    expect(screen.queryByRole('button', { name: t('controls.cannotHear') })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('controls.more') }));
    const menu = await screen.findByRole('menu');
    await user.click(within(menu).getByRole('menuitem', { name: t('controls.cannotHear') }));
    expect(base.onSignal).toHaveBeenCalledWith('cannot_hear');
    expect(document.querySelector('[role="menu"]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  });

  it('shows blur, fullscreen and the signals inline on a wide screen', async () => {
    setWide(true);
    const user = userEvent.setup();
    const base = props();
    renderWithI18n(<ControlBar {...base} />);
    await user.click(screen.getByRole('button', { name: t('controls.blurOn') }));
    expect(base.onToggleBlur).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: t('controls.cannotSee') }));
    expect(base.onSignal).toHaveBeenCalledWith('cannot_see');
    await user.click(screen.getByRole('button', { name: t('controls.fullscreen') }));
    expect(base.onToggleFullscreen).toHaveBeenCalledOnce();
  });

  it('disables blur with an explanation where the browser cannot run it', () => {
    setWide(true);
    renderWithI18n(<ControlBar {...props({ blur: { supported: false, enabled: false, loading: false } })} />);
    const blur = screen.getByRole('button', { name: t('controls.blurOn') });
    expect(blur).toBeDisabled();
    expect(blur).toHaveAccessibleDescription(t('controls.blurUnavailable'));
  });

  it('never offers a camera control to a webinar attendee (D-CW-35)', async () => {
    setWide(true);
    const user = userEvent.setup();
    renderWithI18n(<ControlBar {...props({ participantRole: 'attendee', cameraOn: false })} />);
    expect(screen.queryByRole('button', { name: t('controls.cameraOn') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('controls.cameraOff') })).toBeNull();
    expect(screen.queryByRole('button', { name: t('controls.blurOn') })).toBeNull();
    await user.click(screen.getByRole('button', { name: t('controls.devices') }));
    const menu = await screen.findByRole('menu');
    expect(within(menu).queryByText(/camera/i)).toBeNull();
  });

  it('lets the expert end for everyone after confirming; the employee has no such control', async () => {
    const user = userEvent.setup();
    const onEndForEveryone = vi.fn();
    const { unmount } = renderWithI18n(<ControlBar {...props()} onEndForEveryone={onEndForEveryone} />);
    expect(screen.queryByRole('button', { name: t('controls.endForEveryone') })).toBeNull();
    unmount();

    renderWithI18n(<ControlBar {...props({ participantRole: 'expert' })} onEndForEveryone={onEndForEveryone} />);
    await user.click(screen.getByRole('button', { name: t('controls.endForEveryone') }));
    const dialog = await screen.findByRole('alertdialog', { name: t('controls.endConfirmTitle') });
    await user.click(within(dialog).getByRole('button', { name: t('consultation.end') }));
    expect(onEndForEveryone).toHaveBeenCalledOnce();
  });

  it('shows the expert a screen-share control and the sharing indicator (CALL-22)', async () => {
    setWide(true);
    const user = userEvent.setup();
    const onToggleScreenShare = vi.fn();
    const { rerender } = renderWithI18n(<ControlBar {...props({ participantRole: 'expert' })} onToggleScreenShare={onToggleScreenShare} />);
    await user.click(screen.getByRole('button', { name: t('controls.shareScreen') }));
    expect(onToggleScreenShare).toHaveBeenCalledOnce();
    rerender(<ControlBar {...props({ participantRole: 'expert' })} onToggleScreenShare={onToggleScreenShare} sharingScreen />);
    expect(screen.getByRole('button', { name: t('controls.stopSharing') })).toBeInTheDocument();
    expect(screen.getByText(t('controls.sharingIndicator'), { selector: 'p' })).toBeInTheDocument();
  });

  it('renders an error raised by a control action', () => {
    renderWithI18n(<ControlBar {...props()} error="The signal could not be sent." />);
    expect(screen.getByRole('alert')).toHaveTextContent('The signal could not be sent.');
  });

  it('leaves, and keeps every control at least 44 px tall', async () => {
    const user = userEvent.setup();
    const base = props();
    renderWithI18n(<ControlBar {...base} />);
    await user.click(screen.getByRole('button', { name: t('consultation.leave') }));
    expect(base.onLeave).toHaveBeenCalledOnce();
    for (const button of screen.getAllByRole('button')) expect(button.className).toMatch(/\bmin-h-1[12]\b/);
  });

  it('passes axe', async () => {
    setWide(true);
    const { container } = renderWithI18n(<ControlBar {...props({ participantRole: 'expert' })} onEndForEveryone={vi.fn()} onToggleScreenShare={vi.fn()} />);
    await expectNoA11yViolations(container);
  });
});
