import { cn } from '../../../lib/cn';

export type AvatarSize = 'sm' | 'md' | 'lg';

export interface AvatarProps {
  initials: string;
  name: string;
  size?: AvatarSize;
  src?: string;
  className?: string;
}

const sizeClasses: Record<AvatarSize, string> = {
  sm: 'w-8 h-8 text-sm',
  md: 'w-12 h-12 text-base',
  lg: 'w-16 h-16 text-lg',
};

/** Circle only for sm, rounded-card otherwise (handoff contract). */
function borderRadius(size: AvatarSize): string {
  return size === 'sm' ? 'rounded-full' : 'rounded-card';
}

export function Avatar({ initials, name, size = 'md', src, className }: AvatarProps) {
  const baseClasses = cn(
    'inline-grid place-items-center overflow-hidden bg-accent text-on-accent font-[var(--font-weight-label)]',
    sizeClasses[size],
    borderRadius(size),
    className,
  );

  if (src) {
    return (
      <img
        src={src}
        alt={name}
        className={cn(baseClasses, 'object-cover')}
      />
    );
  }

  return (
    <span className={baseClasses} role="img" aria-label={name}>
      {initials}
    </span>
  );
}
