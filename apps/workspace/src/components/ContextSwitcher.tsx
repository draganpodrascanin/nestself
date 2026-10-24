import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CaretUpDown } from '@phosphor-icons/react';
import { Menu, MenuTrigger, MenuPopup, MenuItem } from '@nestself/ui';
import type { ActiveContext, AvailableContextEntry } from '@nestself/contracts';
import { useAuth } from '../auth';

function contextLabel(entry: AvailableContextEntry, t: (key: string, opts?: Record<string, string>) => string): string {
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

export function ContextSwitcher() {
  const { t } = useTranslation('workspace');
  const { principal, availableContexts, switchContext } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  if (!principal || availableContexts.length <= 1) return null;

  const currentLabel = contextLabel(
    availableContexts.find((e) => isSameContext(principal.context, e)) ?? { kind: principal.context.kind } as AvailableContextEntry,
    t,
  );

  const handleSwitch = async (entry: AvailableContextEntry) => {
    if (isSameContext(principal.context, entry)) return;
    setSwitching(true);
    setSwitchError(null);
    try {
      await switchContext(entryToContext(entry));
    } catch {
      setSwitchError(t('contextSwitcher.switchFailed'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative">
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
                {current && (
                  <span className="type-metadata text-text-tertiary ml-2">
                    {t('contextSwitcher.current')}
                  </span>
                )}
              </MenuItem>
            );
          })}
        </MenuPopup>
      </Menu>
      {switching && (
        <span className="absolute -bottom-5 left-0 type-metadata text-text-tertiary" aria-live="polite">
          {t('contextSwitcher.label')}…
        </span>
      )}
      {switchError && (
        <span className="absolute -bottom-5 left-0 type-metadata text-danger" role="alert">
          {switchError}
        </span>
      )}
    </div>
  );
}
