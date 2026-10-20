import { Fieldset as BaseFieldset } from '@base-ui/react/fieldset';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface FieldsetProps {
  legend: string;
  description?: string;
  children: ReactNode;
  className?: string;
}

export function Fieldset({
  legend,
  description,
  children,
  className,
}: FieldsetProps) {
  return (
    <BaseFieldset.Root className={cn('flex flex-col gap-3 border-0 p-0 m-0', className)}>
      <BaseFieldset.Legend className="type-label text-text">
        {legend}
      </BaseFieldset.Legend>
      {description ? <p className="type-metadata text-text-secondary -mt-2">{description}</p> : null}
      {children}
    </BaseFieldset.Root>
  );
}
