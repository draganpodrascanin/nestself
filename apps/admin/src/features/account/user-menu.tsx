/**
 * Header user menu: who is signed in, in which context, a Settings link and
 * Sign out. Sign out ends the session and lands on `/sign-in`.
 */
import { useTranslation } from 'react-i18next';
import { useNavigate } from '@tanstack/react-router';
import { Menu, MenuItem, MenuPopup, MenuTrigger, VisuallyHidden } from '@nestself/ui';
import { useAuth } from '../../auth';
import { useSignOutAndLeave } from './use-account';

export function UserMenu() {
  const { t } = useTranslation('auth');
  const { principal } = useAuth();
  const navigate = useNavigate();
  const leave = useSignOutAndLeave();

  if (!principal) return null;

  const menuLabel = t('auth:account.userMenu.open', { name: principal.displayName });
  const contextLabel = t(`auth:account.userMenu.context.${principal.context.kind}`);

  return (
    <Menu>
      <MenuTrigger variant="quiet">
        <span className="flex items-center gap-2">
          <VisuallyHidden>{menuLabel}</VisuallyHidden>
          <span
            aria-hidden
            className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-tint type-label text-primary"
          >
            {principal.initials}
          </span>
          <span aria-hidden className="hidden @min-[640px]:flex flex-col items-start text-left">
            <span className="type-label text-text">{principal.displayName}</span>
            <span className="type-metadata text-text-secondary">{contextLabel}</span>
          </span>
        </span>
      </MenuTrigger>
      <MenuPopup aria-label={menuLabel} className="min-w-56">
        <div className="px-3 py-2 border-b border-border-subtle mb-1">
          <p className="type-label text-text">{principal.displayName}</p>
          <p className="type-metadata text-text-secondary">{contextLabel}</p>
        </div>
        <MenuItem onClick={() => void navigate({ to: '/settings' })}>{t('auth:account.userMenu.settings')}</MenuItem>
        <MenuItem onClick={() => void leave()}>{t('auth:account.userMenu.signOut')}</MenuItem>
      </MenuPopup>
    </Menu>
  );
}
