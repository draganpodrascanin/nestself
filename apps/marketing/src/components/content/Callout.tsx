'use client';

import type { ReactNode } from 'react';
import { Alert } from '@nestself/ui';
import type { AlertTone } from '@nestself/ui';
import { Info, Lightbulb, Warning } from '@phosphor-icons/react';

export type CalloutKind = 'note' | 'tip' | 'warning';

export interface CalloutProps {
  kind?: CalloutKind;
  children: ReactNode;
}

const kindToTone: Record<CalloutKind, AlertTone> = {
  note: 'info',
  tip: 'success',
  warning: 'warning',
};

const kindToLabel: Record<CalloutKind, string> = {
  note: 'Note',
  tip: 'Tip',
  warning: 'Warning',
};

function CalloutIcon({ kind }: { kind: CalloutKind }) {
  const size = 20;
  switch (kind) {
    case 'tip':
      return <Lightbulb size={size} weight="duotone" />;
    case 'warning':
      return <Warning size={size} weight="duotone" />;
    case 'note':
    default:
      return <Info size={size} weight="duotone" />;
  }
}

/**
 * Callout block for MDX content.
 *
 * Uses Alert's `title` prop to surface the callout kind label.
 * Alert already provides `role="status"` (info/success) or `role="alert"`
 * (warning/danger), so the base accessibility contract is met without an
 * extra aria-label (which AlertProps does not accept).
 */
export function Callout({ kind = 'note', children }: CalloutProps) {
  return (
    <Alert
      tone={kindToTone[kind]}
      icon={<CalloutIcon kind={kind} />}
      title={kindToLabel[kind]}
      className="my-6"
    >
      {children}
    </Alert>
  );
}
