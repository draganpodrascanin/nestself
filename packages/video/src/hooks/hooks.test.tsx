import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { CallJoinResponse } from '@nestself/contracts';
import { StrictMode } from 'react';
import { CallSessionController } from '../controller';
import { FakeCallSessionController } from '../testing/fake-controller';
import { useCallSessionController } from './useCallSessionController';
import { createMemoryPreferenceStore, VIDEO_STORAGE_KEYS } from '../preferences';
import { useCallSession } from './useCallSession';
import { useDevices } from './useDevices';
import { useConnectionQuality } from './useConnectionQuality';
import { useVideoTiles } from './useVideoTiles';

const JOIN = {
  sessionId: 'session-1',
  participantId: 'participant-1',
  role: 'employee',
  format: 'consultation',
  startsAt: '2030-01-10T09:00:00.000Z',
  endsAt: '2030-01-10T09:45:00.000Z',
} as CallJoinResponse;

describe('useCallSession', () => {
  it('follows the controller through checking, joining and connected', async () => {
    const controller = new FakeCallSessionController();
    const { result } = renderHook(() => useCallSession(controller));
    expect(result.current.status).toBe('idle');
    expect(result.current.canJoin).toBe(false);

    await act(() => result.current.checkReadiness());
    expect(result.current.readiness.status).toBe('done');
    expect(result.current.canJoin).toBe(true);

    const join = vi.spyOn(controller, 'join');
    await act(() => result.current.join(JOIN));
    expect(join).toHaveBeenCalledWith(JOIN);
    expect(result.current.status).toBe('connected');
    expect(result.current.isInCall).toBe(true);
  });

  it('cannot join before the microphone is granted (CALL-03)', async () => {
    const controller = new FakeCallSessionController({ readiness: { microphone: 'denied' } });
    const { result } = renderHook(() => useCallSession(controller));
    await act(() => result.current.checkReadiness());
    expect(result.current.canJoin).toBe(false);
  });

  it('lets a webinar attendee join without a microphone', async () => {
    const controller = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
    const { result } = renderHook(() => useCallSession(controller));
    await act(() => result.current.checkReadiness());
    expect(result.current.canJoin).toBe(true);
  });

  it('ends for everyone through the API callback, then leaves', async () => {
    const controller = new FakeCallSessionController({ role: 'expert' });
    const onEndForEveryone = vi.fn(async () => undefined);
    const { result } = renderHook(() => useCallSession(controller, { onEndForEveryone }));
    await act(() => controller.join());
    await act(() => result.current.endForEveryone());
    expect(onEndForEveryone).toHaveBeenCalledOnce();
    expect(result.current.status).toBe('left');
  });

  it('stays in the call when ending for everyone fails, and rethrows for the screen to show', async () => {
    const controller = new FakeCallSessionController({ role: 'expert' });
    const onEndForEveryone = vi.fn(async () => Promise.reject(new Error('video_provider_unavailable')));
    const { result } = renderHook(() => useCallSession(controller, { onEndForEveryone }));
    await act(() => controller.join());
    await expect(act(() => result.current.endForEveryone())).rejects.toThrow('video_provider_unavailable');
    expect(result.current.status).toBe('connected');
  });

  it('toggles media through the controller', async () => {
    const controller = new FakeCallSessionController();
    const { result } = renderHook(() => useCallSession(controller));
    await act(() => controller.join());
    act(() => result.current.toggleMute());
    expect(result.current.media.muted).toBe(true);
    await act(() => result.current.toggleCamera());
    expect(result.current.media.cameraOn).toBe(false);
  });
});

describe('useDevices', () => {
  it('lists devices, selects one and persists it', async () => {
    const store = createMemoryPreferenceStore();
    const controller = new FakeCallSessionController({ store });
    const { result } = renderHook(() => useDevices(controller));
    await act(() => controller.checkReadiness());
    expect(result.current.cameras).toHaveLength(2);
    expect(result.current.permissions).toEqual({ camera: 'granted', microphone: 'granted' });
    await act(() => result.current.selectDevice('camera', 'sample-camera-2'));
    expect(result.current.selected.camera).toBe('sample-camera-2');
    expect(store.get(VIDEO_STORAGE_KEYS.camera)).toBe('sample-camera-2');
  });

  it('reports a denied camera and the blur state', async () => {
    const controller = new FakeCallSessionController({ readiness: { camera: 'denied' }, blurSupported: false });
    const { result } = renderHook(() => useDevices(controller));
    await act(() => controller.checkReadiness());
    expect(result.current.permissions.camera).toBe('denied');
    await act(() => result.current.setBlur(true));
    expect(result.current.blur).toEqual({ supported: false, enabled: false, loading: false });
  });
});

describe('useConnectionQuality', () => {
  it('exposes the level, degraded mode and reconnecting', () => {
    const controller = new FakeCallSessionController();
    const { result } = renderHook(() => useConnectionQuality(controller));
    expect(result.current).toMatchObject({ level: 'good', videoPaused: false, reconnecting: false });
    act(() => controller.simulate.quality('poor', { videoPaused: true, lowResolution: true }));
    expect(result.current).toMatchObject({ level: 'poor', videoPaused: true, lowResolution: true });
    act(() => controller.simulate.reconnecting());
    expect(result.current.reconnecting).toBe(true);
  });

  it('keeps the same object while nothing changed', () => {
    const controller = new FakeCallSessionController();
    const { result, rerender } = renderHook(() => useConnectionQuality(controller));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
  });
});

describe('useVideoTiles', () => {
  it('prefers shared content over the remote camera and binds tiles', async () => {
    const controller = new FakeCallSessionController();
    const bind = vi.spyOn(controller, 'bindVideoTile');
    const unbind = vi.spyOn(controller, 'unbindVideoTile');
    const { result } = renderHook(() => useVideoTiles(controller));
    await act(() => controller.join());
    expect(result.current.localTileId).toBe(1);
    expect(result.current.primaryTileId).toBeNull();

    let remote = 0;
    act(() => {
      remote = controller.simulate.remoteJoined();
    });
    expect(result.current.primaryTileId).toBe(remote);
    act(() => controller.simulate.contentShared(true));
    await waitFor(() => expect(result.current.primaryTileId).toBe(result.current.contentTileId));
    expect(result.current.remoteTileIds).toEqual([remote]);

    const element = document.createElement('video');
    result.current.bind(remote, element);
    result.current.unbind(remote);
    expect(bind).toHaveBeenCalledWith(remote, element);
    expect(unbind).toHaveBeenCalledWith(remote);
  });
});

describe('useCallSessionController and owned sessions (guidelines 11.2)', () => {
  const options = () => ({ role: 'employee' as const, store: createMemoryPreferenceStore() });

  it('creates one controller and destroys it on unmount', async () => {
    const destroy = vi.spyOn(CallSessionController.prototype, 'destroy');
    const { result, rerender, unmount } = renderHook(() => useCallSessionController(options()));
    const first = result.current;
    rerender();
    expect(result.current).toBe(first);
    expect(first).toBeInstanceOf(CallSessionController);
    unmount();
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    destroy.mockRestore();
  });

  it('survives a StrictMode effect replay without destroying the live controller', async () => {
    const destroy = vi.spyOn(CallSessionController.prototype, 'destroy');
    const { unmount } = renderHook(() => useCallSessionController(options()), { wrapper: StrictMode });
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(destroy).not.toHaveBeenCalled();
    unmount();
    await waitFor(() => expect(destroy).toHaveBeenCalled());
    destroy.mockRestore();
  });

  it('useCallSession owns a controller when given options, and only then', async () => {
    const destroy = vi.spyOn(CallSessionController.prototype, 'destroy');
    const owned = renderHook(() => useCallSession(options()));
    expect(owned.result.current.controller).toBeInstanceOf(CallSessionController);
    expect(owned.result.current.status).toBe('idle');
    owned.unmount();
    await waitFor(() => expect(destroy).toHaveBeenCalledOnce());
    destroy.mockRestore();

    const external = new FakeCallSessionController();
    const destroyExternal = vi.spyOn(external, 'destroy');
    const borrowed = renderHook(() => useCallSession(external));
    expect(borrowed.result.current.controller).toBe(external);
    borrowed.unmount();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(destroyExternal).not.toHaveBeenCalled();
  });
});
