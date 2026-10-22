/**
 * Public layout -- minimal centred shell for sign-in, invite, reset-password.
 * Sits outside _authenticated, so no principal is required.
 */
import { createFileRoute, Outlet } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { localeMeta } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

function LocaleSwitcher() {
  const { i18n } = useTranslation();
  const currentLocale = (i18n.resolvedLanguage ?? 'sr-Latn') as Locale;

  return (
    <div className="flex flex-wrap justify-center gap-2">
      {(Object.entries(localeMeta) as [Locale, (typeof localeMeta)[Locale]][]).map(
        ([key, meta]) => (
          <button
            key={key}
            type="button"
            onClick={() => i18n.changeLanguage(key)}
            className={`type-metadata px-2 py-1 rounded-control ${
              key === currentLocale
                ? 'text-primary font-[var(--font-weight-label)]'
                : 'text-text-secondary hover:text-text'
            }`}
            lang={meta.htmlLang}
          >
            {meta.nativeName}
            {meta.scriptLabel ? ` (${meta.scriptLabel})` : ''}
          </button>
        ),
      )}
    </div>
  );
}

function PublicLayout() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-[28rem] px-4 py-12">
        <div className="mb-8 text-center">
          <p className="type-label text-primary text-lg">NestSelf Admin</p>
        </div>
        <div className="sm:rounded-card sm:border sm:border-border-subtle sm:bg-surface sm:p-6">
          <Outlet />
        </div>
        <div className="mt-8">
          <LocaleSwitcher />
        </div>
      </div>
    </div>
  );
}

export const Route = createFileRoute('/_public')({
  component: PublicLayout,
});
