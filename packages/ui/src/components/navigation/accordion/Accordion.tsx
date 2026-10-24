import { Accordion as BaseAccordion } from '@base-ui/react/accordion';
import { CaretDown } from '@phosphor-icons/react/dist/ssr';
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
      onValueChange={onValueChange ? (val) => onValueChange(val as string[]) : undefined}
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
  /**
   * Keep the panel content in the DOM when collapsed.
   * Useful for accessibility (screen readers, in-page search).
   */
  keepMounted?: boolean;
  className?: string;
}

export function AccordionItem({
  value,
  title,
  children,
  headingLevel,
  keepMounted,
  className,
}: AccordionItemProps) {
  const HeaderTag = headingLevel ? (`h${headingLevel}` as const) : undefined;

  return (
    <BaseAccordion.Item value={value} className={className}>
      <BaseAccordion.Header {...(HeaderTag ? { render: <HeaderTag /> } : {})} className="m-0">
        <BaseAccordion.Trigger
          className={cn(
            'group gap-3 flex w-full items-center justify-between',
            'min-h-11 px-0 py-3 cursor-pointer type-body text-text',
            'border-0 bg-transparent text-left',
            'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
            'pointer-coarse:min-h-12',
          )}
        >
          {title}
          <CaretDown
            size={16}
            aria-hidden
            className={cn(
              'shrink-0 text-text-secondary transition-transform duration-[var(--motion-standard)] ease-standard',
              'motion-reduce:transition-none',
              'group-data-panel-open:rotate-180',
            )}
          />
        </BaseAccordion.Trigger>
      </BaseAccordion.Header>
      {/*
        Base UI measures the panel into --accordion-panel-height and sequences
        the open and close around the CSS transition, so the panel animates
        with tokens here rather than through Motion. Padding lives on the
        inner element so the panel collapses all the way to zero.
      */}
      <BaseAccordion.Panel
        keepMounted={keepMounted}
        className={cn(
          'overflow-hidden type-body text-text-secondary',
          'h-[var(--accordion-panel-height)] transition-[height,opacity] duration-[var(--motion-standard)] ease-standard',
          'data-starting-style:h-0 data-starting-style:opacity-0 data-ending-style:h-0 data-ending-style:opacity-0',
          'motion-reduce:transition-none',
        )}
      >
        <div className="pb-4">{children}</div>
      </BaseAccordion.Panel>
    </BaseAccordion.Item>
  );
}
