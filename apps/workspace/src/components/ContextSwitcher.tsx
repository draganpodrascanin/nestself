/**
 * Context switcher for the workspace shell (C-22, Ruling C).
 *
 * - Uses `Menu` from `@nestself/ui` (Motion rule compliant).
 * - Labels: "My space . {orgName}", "Manage . {orgName}", "Expert", "Operations".
 * - Current context is marked and its label visible in the shell.
 * - Hidden when there is at most one available context.
 * - A failed switch shows translated copy through `useToast` from `@nestself/ui`
 *   with an `error.unknown` fallback, mapped from the API error code.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretUpDown, Check } from '@phosphor-icons/react';
import { Menu, MenuTrigger, MenuPopup, MenuItem, useToast } from '@nestself/ui';
import { ApiError } from '@nestself/api-client';
import type { ActiveContext, AvailableContextEntry } from '@nestself/contracts';
import { useAuth } from '../auth';

function contextLabel(
  entry: AvailableContextEntry,
  t: (key: string, opts?: Record<string, string>) => string,
): string {
  switch (entry.kind) {
    case 'personal':
      return entry.orgId
        ? t('contextSwitcher.personalWithOrg', { orgName: entry.orgName ?? entry.orgId })
        : t('contextSwitcher.personal');
    case 'organization':
      return t('contextSwitcher.organization', { orgName: entry.orgName ?? entry.orgId });
    case 'expert':
      return t('contextSwitcher.expert');
    case 'operations':
      return t('contextSwitcher.operations');
  }
}

function isSameContext(a: ActiveContext, b: AvailableContextEntry): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === 'personal' && b.kind === 'personal') return a.orgId === b.orgId;
  if (a.kind === 'organization' && b.kind === 'organization') return a.orgId === b.orgId;
  return true;
}

function entryToContext(entry: AvailableContextEntry): ActiveContext {
  switch (entry.kind) {
    case 'personal':
      return entry.orgId ? { kind: 'personal', orgId: entry.orgId } : { kind: 'personal' };
    case 'organization':
      return { kind: 'organization', orgId: entry.orgId };
    case 'expert':
      return { kind: 'expert' };
    case 'operations':
      return { kind: 'operations' };
  }
}

/** Map an API error code to a translated message (Ruling C). */
function switchErrorMessage(
  err: unknown,
  t: (key: string) => string,
): string {
  if (err instanceof ApiError && err.code) {
    const key = `contextSwitcher.error.${err.code}`;
    const translated = t(key);
    // If the i18n key is missing, the library returns the key itself.
    if (translated !== key) return translated;
  }
  return t('contextSwitcher.error.unknown');
}

export function ContextSwitcher() {
  const { t } = useTranslation('workspace');
  const { principal, availableContexts, switchContext } = useAuth();
  const [switching, setSwitching] = useState(false);
  const toast = useToast();

  if (!principal || availableContexts.length <= 1) return null;

  const currentEntry = availableContexts.find((e) =>
    isSameContext(principal.context, e),
  ) ?? ({ kind: principal.context.kind } as AvailableContextEntry);

  const currentLabel = contextLabel(currentEntry, t);

  const handleSwitch = async (entry: AvailableContextEntry) => {
    if (isSameContext(principal.context, entry)) return;
    setSwitching(true);
    try {
      await switchContext(entryToContext(entry));
    } catch (err) {
      toast.add({
        title: t('contextSwitcher.switchFailed'),
        description: switchErrorMessage(err, t),
        tone: 'danger',
      });
    } finally {
      setSwitching(false);
    }
  };

  return (
    <Menu>
      <MenuTrigger variant="quiet" className="type-body-sm gap-1.5 max-w-[200px]">
        <span className="truncate">{currentLabel}</span>
        <CaretUpDown size={14} aria-hidden />
      </MenuTrigger>
      <MenuPopup aria-label={t('contextSwitcher.label')} className="min-w-[180px]">
        {availableContexts.map((entry, i) => {
          const current = isSameContext(principal.context, entry);
          return (
            <MenuItem
              key={`${entry.kind}-${'orgId' in entry ? entry.orgId : ''}-${i}`}
              onClick={() => void handleSwitch(entry)}
              className={current ? 'text-primary font-medium' : ''}
            >
              <span className="flex-1 truncate">{contextLabel(entry, t)}</span>
              {current && <Check size={16} className="text-primary ml-2" aria-hidden />}
            </MenuItem>
          );
        })}
      </MenuPopup>
      {switching && (
        <span className="absolute -bottom-5 left-0 type-metadata text-text-tertiary" aria-live="polite">
          {t('contextSwitcher.label')}…
        </span>
      )}
    </Menu>
  );
}
