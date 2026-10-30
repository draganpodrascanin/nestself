import type { TFunction } from 'i18next';
import type { DeviceKind, DeviceOption } from '../types';

const FALLBACK_KEY: Record<DeviceKind, string> = {
  camera: 'prejoin.cameraFallback',
  microphone: 'prejoin.microphoneFallback',
  speaker: 'prejoin.speakerFallback',
};

/** The device's own label, or "Camera 2" before the browser reveals labels. */
export function deviceLabel(t: TFunction, kind: DeviceKind, device: DeviceOption, index: number): string {
  return device.label || (t(FALLBACK_KEY[kind], { index: index + 1 }) as string);
}
