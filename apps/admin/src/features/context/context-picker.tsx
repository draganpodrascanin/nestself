/**
 * Header context picker: personal, each organization the user is an ACTIVE
 * member of (by name), expert and operations as available. Choosing one
 * calls `switchContext` (the API answers with the new effective actions)
 * and then `refreshPrincipal`, so gated navigation follows without a reload
 * (Review Focus 4). A failed switch shows a toast with translated copy.
 *
 * Convenience only: `POST /auth/context` checks the same rule on the server.
 * The operations screens switch to the operations context only when the
 * session is not already in it and never after it was, so they do not undo
 * this choice.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Check } from '@phosphor-icons/react';
import { Menu, MenuItem, MenuPopup, MenuTrigger, VisuallyHidden, useToast } from '@nestself/ui';
import { useAuth } from '../../auth';
import { contextErrorKey } from './context-errors';
import { contextOptions, sameContext } from './context-options';
import type { ContextOption } from './context-options';

export interface ContextPickerProps {
  /** Sample mode: the switch is local to the sample principal and creates nothing. */
  sampleMode: boolean;
}

export function ContextPicker({ sampleMode }: ContextPickerProps) {
  const { t } = useTranslation('auth');
  const { principal, switchContext, refreshPrincipal } = useAuth();
  const { add: addToast } = useToast();
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);

  const { availableContexts } = useAuth();
  if (!principal) return null;
  const options = contextOptions(availableContexts);
  // One option means there is nothing to choose between.
  if (options.length < 2) return null;

  const label = (option: ContextOption) =>
    ('orgName' in option)
      ? option.orgName
      : t(`auth:context.picker.option.${option.key as 'expert' | 'operations'}`);
  const current = options.find((o) => sameContext(o.context, principal.context)) ?? null;
  const currentLabel = current ? label(current) : t('auth:context.picker.none');
  const triggerLabel = t('auth:context.picker.open', { name: currentLabel });

  const choose = async (option: ContextOption) => {
    if (pending || (current && option.key === current.key)) return;
    setPending(true);
    try {
      try {
        await switchContext(option.context);
      } catch (err) {
        const key = contextErrorKey(err);
        addToast({
          tone: 'danger',
          title: t('auth:context.picker.errors.title'),
          description: t(`auth:context.picker.errors.${key}`),
        });
        // The context is no longer valid (an ended membership, for example):
        // reload the principal so the menu stops offering it.
        if (key === 'invalidContext' || key === 'orgContextExpired') {
          await refreshPrincipal().catch(() => undefined);
        }
        return;
      }
      // The switch happened; a failed refresh is not a failed switch (the
      // provider keeps the switch's own answer and reports its own error).
      await refreshPrincipal().catch(() => undefined);
      // Every operations screen needs the operations context: start from the
      // overview rather than leave a screen that can no longer load.
      void navigate({ to: '/' });
    } finally {
      setPending(false);
    }
  };

  return (
    <Menu>
      <MenuTrigger variant="quiet">
        <span className="flex items-center gap-1">
          <VisuallyHidden>{triggerLabel}</VisuallyHidden>
          <span aria-hidden className="type-label text-text max-w-24 truncate @min-[480px]:max-w-40">
            {currentLabel}
          </span>
        </span>
      </MenuTrigger>
      <MenuPopup aria-label={t('auth:context.picker.heading')} className="min-w-56">
        <p className="px-3 py-2 type-metadata text-text-secondary border-b border-border-subtle mb-1">
          {t('auth:context.picker.heading')}
        </p>
        {options.map((option) => {
          const isCurrent = current?.key === option.key;
          return (
            <MenuItem key={option.key} onClick={() => void choose(option)} className="justify-between gap-3">
              <span>{label(option)}</span>
              {isCurrent ? (
                <>
                  <Check size={16} aria-hidden />
                  <VisuallyHidden>{t('auth:context.picker.current')}</VisuallyHidden>
                </>
              ) : null}
            </MenuItem>
          );
        })}
        {sampleMode ? (
          <p className="px-3 py-2 type-metadata text-text-secondary border-t border-border-subtle mt-1 max-w-64">
            {t('auth:context.picker.sampleNote')}
          </p>
        ) : null}
      </MenuPopup>
    </Menu>
  );
}
