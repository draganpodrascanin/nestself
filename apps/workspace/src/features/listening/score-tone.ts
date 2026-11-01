/**
 * Colour and copy of a report cell (spec 4.3, 11): the semantic tone comes
 * from the status the API classified, the text label always travels with it.
 * Gray states name their reason; "no problem detected" is never shown for a
 * hidden cell.
 */
import type { BadgeTone } from '@nestself/ui';
import type { DimensionCell, GrayReason, ScoreStatus } from '@nestself/contracts';

export const STATUS_TONE: Record<ScoreStatus, BadgeTone> = {
  good: 'success',
  monitor: 'warning',
  danger: 'danger',
};

export function scoreTone(cell: Pick<DimensionCell, 'status'>): BadgeTone {
  return cell.status ? STATUS_TONE[cell.status] : 'neutral';
}

/** The i18n key of the cell's text label: its status, or its gray reason, or the stale label for a stale current result. */
export function statusKey(cell: Pick<DimensionCell, 'status' | 'grayReason'>, stale = false): `listening:status.${ScoreStatus | GrayReason | 'noScore'}` {
  if (cell.status && stale) return 'listening:status.stale';
  if (cell.status) return `listening:status.${cell.status}`;
  if (cell.grayReason) return `listening:status.${cell.grayReason}`;
  return 'listening:status.noScore';
}

/** `+2.0` / `-8.0` from tenths. */
export function formatPoints(deltaTenths: number): string {
  const sign = deltaTenths > 0 ? '+' : deltaTenths < 0 ? '-' : '';
  const abs = Math.abs(deltaTenths);
  return `${sign}${Math.floor(abs / 10)}.${abs % 10}`;
}
