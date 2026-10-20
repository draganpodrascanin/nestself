import type { ComponentType } from 'react';
import type { IconProps as PhosphorIconProps } from '@phosphor-icons/react';
import {
  CalendarCheck,
  MagnifyingGlass,
  WarningCircle,
  Clock,
  LockKey,
  ShieldCheck,
} from '@phosphor-icons/react';
import { cn } from '../../../lib/cn';
import { Icon } from '../../foundation/icon/Icon';
import { Skeleton } from '../skeleton/Skeleton';
import { Button } from '../../actions/button/Button';

export type StatusBlockState =
  | 'empty'
  | 'results'
  | 'loading'
  | 'offline'
  | 'stale'
  | 'permission'
  | 'expired'
  | 'protected';

export interface StatusBlockAction {
  label: string;
  onClick: () => void;
}

export interface StatusBlockProps {
  state: StatusBlockState;
  title: string;
  body: string;
  action?: StatusBlockAction;
  icon?: ComponentType<PhosphorIconProps>;
  className?: string;
}

const defaultIcons: Record<StatusBlockState, ComponentType<PhosphorIconProps> | null> = {
  empty: CalendarCheck,
  results: MagnifyingGlass,
  loading: null,
  offline: WarningCircle,
  stale: Clock,
  permission: LockKey,
  expired: ShieldCheck,
  protected: LockKey,
};

export function StatusBlock({
  state,
  title,
  body,
  action,
  icon,
  className,
}: StatusBlockProps) {
  const IconComponent = icon ?? defaultIcons[state];
  const isLoading = state === 'loading';
  const showSecondaryAction = state === 'offline' || state === 'stale';

  return (
    <div
      className={cn(
        'text-center bg-canvas rounded-card p-8',
        className,
      )}
      aria-busy={isLoading || undefined}
    >
      {isLoading ? (
        <Skeleton label={title} />
      ) : (
        <>
          {IconComponent ? (
            <div className="text-primary mb-4">
              <Icon icon={IconComponent} size={48} />
            </div>
          ) : null}
          <h3 className="type-section-title mb-2">{title}</h3>
          <p className="max-w-[52ch] mx-auto text-text-secondary">{body}</p>
          {action ? (
            <div className="mt-5">
              <Button
                variant={showSecondaryAction ? 'secondary' : 'primary'}
                onClick={action.onClick}
              >
                {action.label}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
