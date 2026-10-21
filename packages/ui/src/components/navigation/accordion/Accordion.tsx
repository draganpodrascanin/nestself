import { Accordion as BaseAccordion } from '@base-ui/react/accordion';
import { CaretDown } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

/* ------------------------------------------------------------------ */
/*  Accordion (root)                                                  */
/* ------------------------------------------------------------------ */

export interface AccordionProps {
  /** Allow multiple panels open at the same time. */
  multiple?: boolean;
  /** Initially-open item values (uncontrolled). */
  defaultValue?: string[];
  /** Currently-open item values (controlled). */
  value?: string[];
  /** Fires when the set of open items changes. */
  onValueChange?: (value: string[]) => void;
  children: ReactNode;
  className?: string;
}

export function Accordion({
  multiple,
  defaultValue,
  value,
  onValueChange,
  children,
  className,
}: AccordionProps) {
  return (
    <BaseAccordion.Root
      multiple={multiple}
      defaultValue={defaultValue}
      value={value}
      onValueChange={
        onValueChange
          ? (val) => onValueChange(val as string[])
          : undefined
      }
      className={cn('divide-y divide-border-subtle', className)}
    >
      {children}
    </BaseAccordion.Root>
  );
}

/* ------------------------------------------------------------------ */
/*  AccordionItem                                                     */
/* ------------------------------------------------------------------ */

export interface AccordionItemProps {
  /** A unique value identifying this item. */
  value: string;
  /** Text shown in the trigger button. */
  title: string;
  /** The panel content revealed on expand. */
  children: ReactNode;
  /** Heading level for the header element. */
  headingLevel?: 2 | 3 | 4;
  className?: string;
}

export function AccordionItem({
  value,
  title,
  children,
  headingLevel,
  className,
}: AccordionItemProps) {
  const HeaderTag = headingLevel
    ? (`h${headingLevel}` as const)
    : undefined;

  return (
    <BaseAccordion.Item value={value} className={className}>
      <BaseAccordion.Header
        {...(HeaderTag ? { render: <HeaderTag /> } : {})}
        className="m-0"
      >
        <BaseAccordion.Trigger
          className={cn(
            'group flex w-full items-center justify-between gap-3',
            'min-h-11 px-0 py-3 type-body text-text cursor-pointer',
            'bg-transparent border-0 text-left',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            'pointer-coarse:min-h-12',
          )}
        >
          {title}
          <CaretDown
            size={16}
            aria-hidden
            className={cn(
              'shrink-0 text-text-secondary transition-transform duration-200',
              'motion-reduce:transition-none',
              'group-data-panel-open:rotate-180',
            )}
          />
        </BaseAccordion.Trigger>
      </BaseAccordion.Header>
      <BaseAccordion.Panel
        className={cn(
          'overflow-hidden type-body text-text-secondary',
          'pb-4',
          'transition-[height] duration-200 ease-standard',
          'motion-reduce:transition-none',
        )}
      >
        {children}
      </BaseAccordion.Panel>
    </BaseAccordion.Item>
  );
}
