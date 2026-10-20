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
      className={cn('flex border-b border-border-subtle', className)}
    >
      {children}
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
        'data-selected:text-primary data-selected:border-primary data-selected:border-b-2',
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
