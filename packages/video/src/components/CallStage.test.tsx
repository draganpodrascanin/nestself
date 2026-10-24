import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen, waitFor, within } from '@testing-library/react';
import { useRef } from 'react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { FakeCallSessionController } from '../testing/fake-controller';
import { useFullscreen } from '../hooks/useFullscreen';
import type { CallSessionControllerApi } from '../types';
import { CallStage } from './CallStage';
import { CrisisResourcesButton } from './CrisisBlock';

async function connected(role: 'employee' | 'expert' = 'employee') {
  const controller = new FakeCallSessionController({ role });
  await controller.join();
  return controller;
}

describe('CallStage (UX-10, UX-20, CALL-08)', () => {
  it('shows the remote video large and binds it, with the self-view floating', async () => {
    const controller = await connected();
    const bind = vi.spyOn(controller, 'bindVideoTile');
    renderWithI18n(<CallStage controller={controller} remoteName="Ana" />);
    expect(screen.getByText(t('consultation.waiting'))).toBeInTheDocument();

    let tileId = 0;
    act(() => {
      tileId = controller.simulate.remoteJoined();
    });
    const remote = screen.getByLabelText(t('stage.remoteVideoNamed', { name: 'Ana' }));
    expect(remote.tagName).toBe('VIDEO');
    expect(remote.className).toMatch(/\binset-0\b/);
    expect(bind).toHaveBeenCalledWith(tileId, remote);
    expect(screen.queryByText(t('consultation.waiting'))).toBeNull();

    const self = screen.getByLabelText(t('stage.selfView'));
    expect(bind).toHaveBeenCalledWith(1, self);
    expect(screen.getByTestId('self-view')).toHaveAttribute('data-corner', 'bottom-right');
  });

  it('hides and shows the self-view; hiding animates out (UX-10)', async () => {
    const user = userEvent.setup();
    const controller = await connected();
    renderWithI18n(<CallStage controller={controller} />);
    await user.click(screen.getByRole('button', { name: t('stage.hideSelfView') }));
    expect(screen.queryByLabelText(t('stage.selfView'))).not.toBeNull();
    await waitFor(() => expect(screen.queryByLabelText(t('stage.selfView'))).toBeNull());
    await user.click(screen.getByRole('button', { name: t('stage.showSelfView') }));
    expect(await screen.findByLabelText(t('stage.selfView'))).toBeInTheDocument();
  });

  it('animates the self-view in, and keeps it mounted while it animates out when the camera turns off', async () => {
    const controller = await connected();
    renderWithI18n(<CallStage controller={controller} />);
    const pip = screen.getByLabelText(t('stage.selfView')).closest('[style]') as HTMLElement;
    expect(pip.style.opacity).not.toBe('');
    act(() => void controller.setCameraOn(false));
    expect(screen.queryByTestId('self-view')).not.toBeNull();
    await waitFor(() => expect(screen.queryByTestId('self-view')).toBeNull());
  });

  it('moves the self-view between corners with the keyboard', async () => {
    const user = userEvent.setup();
    const controller = await connected();
    renderWithI18n(<CallStage controller={controller} />);
    const move = screen.getByRole('button', { name: t('stage.moveSelfView') });
    move.focus();
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('self-view')).toHaveAttribute('data-corner', 'bottom-left');
    await user.keyboard('{Enter}');
    expect(screen.getByTestId('self-view')).toHaveAttribute('data-corner', 'top-left');
  });

  it('puts shared content in the main view (CALL-22)', async () => {
    const controller = await connected();
    renderWithI18n(<CallStage controller={controller} />);
    act(() => {
      controller.simulate.remoteJoined();
      controller.simulate.contentShared(true);
    });
    expect(screen.getByLabelText(t('stage.sharedScreen'))).toBeInTheDocument();
  });

  it('offers rejoin and support after reconnection failed (CALL-10)', async () => {
    const user = userEvent.setup();
    const controller = await connected();
    const onRejoin = vi.fn();
    renderWithI18n(<CallStage controller={controller} onRejoin={onRejoin} supportHref="/support" />);
    act(() => controller.simulate.reconnectFailed());
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(t('stage.reconnectFailedTitle'));
    expect(screen.getByRole('link', { name: t('stage.contactSupport') })).toHaveAttribute('href', '/support');
    await user.click(screen.getByRole('button', { name: t('stage.rejoin') }));
    expect(onRejoin).toHaveBeenCalledOnce();
  });

  it('renders a rejoin error, such as a closed join window', async () => {
    const controller = await connected();
    act(() => controller.simulate.reconnectFailed());
    renderWithI18n(<CallStage controller={controller} onRejoin={vi.fn()} error={t('errors.joinWindowClosed')} />);
    expect(screen.getByText(t('errors.joinWindowClosed'))).toBeInTheDocument();
  });

  it('tells the employee when the expert ended the consultation', async () => {
    const controller = await connected();
    renderWithI18n(<CallStage controller={controller} />);
    act(() => controller.simulate.ended());
    expect(await screen.findByText(t('consultation.sessionEnded'))).toBeInTheDocument();
  });

  it('renders the header and controls slots', async () => {
    const controller = await connected();
    renderWithI18n(<CallStage controller={controller} header={<span>header slot</span>} controls={<span>controls slot</span>} />);
    expect(screen.getByText('header slot')).toBeInTheDocument();
    expect(screen.getByText('controls slot')).toBeInTheDocument();
  });

  it('passes axe', async () => {
    const controller = await connected();
    act(() => {
      controller.simulate.remoteJoined();
    });
    const { container } = renderWithI18n(<CallStage controller={controller} remoteName="Ana" />);
    await expectNoA11yViolations(container);
  });
});

describe('CallStage fullscreen', () => {
  let fullscreenElement: Element | null = null;
  // Only the document element is ever made fullscreen here.
  const requestFullscreen = vi.fn(() => {
    fullscreenElement = document.documentElement;
    document.dispatchEvent(new Event('fullscreenchange'));
    return Promise.resolve();
  });

  afterEach(() => {
    fullscreenElement = null;
    Reflect.deleteProperty(document, 'fullscreenElement');
    Reflect.deleteProperty(document, 'fullscreenEnabled');
    Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
    Reflect.deleteProperty(HTMLElement.prototype, 'requestFullscreen');
  });

  function Harness({ controller }: { controller: CallSessionControllerApi }) {
    const stageRef = useRef<HTMLElement>(null);
    const fullscreen = useFullscreen(stageRef);
    return (
      <CallStage
        ref={stageRef}
        controller={controller}
        fullscreen={fullscreen.isFullscreen}
        header={<CrisisResourcesButton />}
        controls={
          <button type="button" onClick={() => void fullscreen.toggle()}>
            {t('controls.fullscreen')}
          </button>
        }
      />
    );
  }

  it('makes the document fullscreen, pins the stage, and the crisis sheet stays visible', async () => {
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => fullscreenElement });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, value: true });
    Object.defineProperty(document.documentElement, 'requestFullscreen', { configurable: true, value: requestFullscreen });
    const stageRequest = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true, value: stageRequest });

    const user = userEvent.setup();
    const controller = await connected();
    renderWithI18n(<Harness controller={controller} />);
    await user.click(screen.getByRole('button', { name: t('controls.fullscreen') }));

    expect(requestFullscreen.mock.contexts[0]).toBe(document.documentElement);
    expect(stageRequest).not.toHaveBeenCalled();
    const stage = screen.getByRole('region', { name: t('stage.label') });
    await waitFor(() => expect(stage).toHaveAttribute('data-fullscreen', 'true'));
    expect(stage.className).toMatch(/\bfixed\b/);

    await user.click(within(stage).getByRole('button', { name: t('crisis.open') }));
    const sheet = await screen.findByRole('dialog', { name: t('crisis.title') });
    expect(document.fullscreenElement?.contains(sheet)).toBe(true);
    expect(within(sheet).getByRole('link', { name: /112/ })).toBeInTheDocument();
  });
});
