'use client';

import { useId } from 'react';
import { LockKey } from '@phosphor-icons/react/dist/ssr';
import { cn } from '../../../lib/cn';
import { Icon } from '../../foundation/icon/Icon';

export interface ProtectedValueProps {
  /** The display word (e.g. "Protected"). Never a number. */
  label: string;
  /** The accessibility reason why this value is protected. */
  reason: string;
  /** Optional action to let users request access to the total. */
  totalAction?: React.ReactNode;
  className?: string;
}

export function ProtectedValue({ label, reason, totalAction, className }: ProtectedValueProps) {
  const reasonId = useId();
  return (
    <span className={cn('gap-2 inline-flex items-center text-text-secondary', className)}>
      <Icon icon={LockKey} size={16} />
      <span aria-describedby={reasonId}>{label}</span>
      <span id={reasonId} className="sr-only">
        {reason}
      </span>
      {totalAction}
    </span>
  );
}
