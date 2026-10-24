import { Tabs as BaseTabs } from '@base-ui/react/tabs';
import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';

export interface TabsProps {
  defaultValue?: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
  className?: string;
}

export function Tabs({ defaultValue, value, onValueChange, children, className }: TabsProps) {
  return (
    <BaseTabs.Root
      defaultValue={defaultValue}
      value={value}
      onValueChange={(val) => onValueChange?.(val as string)}
      className={className}
    >
      {children}
    </BaseTabs.Root>
  );
}

export interface TabListProps {
  children: ReactNode;
  label: string;
  className?: string;
}

export function TabList({ children, label, className }: TabListProps) {
  return (
    <BaseTabs.List
      aria-label={label}
      className={cn('relative flex border-b border-border-subtle', className)}
    >
      {children}
      {/* Slides between tabs; Base UI writes the active tab's box into CSS variables. */}
      <BaseTabs.Indicator
        renderBeforeHydration
        className={cn(
          'bottom-0 left-0 h-0.5 pointer-events-none absolute bg-primary',
          'w-[var(--active-tab-width)] translate-x-[var(--active-tab-left)]',
          'transition-[translate,width] duration-[var(--motion-standard)] ease-standard motion-reduce:transition-none',
        )}
      />
    </BaseTabs.List>
  );
}

export interface TabProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function Tab({ value, children, className }: TabProps) {
  return (
    <BaseTabs.Tab
      value={value}
      className={cn(
        'min-h-11 px-4 py-2 text-text-secondary cursor-pointer bg-transparent border-b-2 border-transparent',
        'transition-colors duration-[var(--motion-fast)] ease-standard',
        'data-selected:text-primary',
        'focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus',
        'pointer-coarse:min-h-12',
        className,
      )}
    >
      {children}
    </BaseTabs.Tab>
  );
}

export interface TabPanelProps {
  value: string;
  children: ReactNode;
  className?: string;
}

export function TabPanel({ value, children, className }: TabPanelProps) {
  return (
    <BaseTabs.Panel value={value} className={cn('py-4', className)}>
      {children}
    </BaseTabs.Panel>
  );
}
