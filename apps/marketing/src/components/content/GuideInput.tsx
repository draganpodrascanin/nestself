import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { cn } from '@nestself/ui';

const sharedClasses =
  'w-full rounded-control border border-border-control bg-surface p-3 type-body focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus';

export function GuideTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  return (
    <textarea
      {...props}
      className={cn(sharedClasses, 'min-h-[80px] resize-y', props.className)}
    />
  );
}

export function GuideInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={cn(sharedClasses, props.className)} />;
}
