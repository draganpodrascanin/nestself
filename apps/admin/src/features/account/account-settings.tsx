/**
 * Account section of Settings: display name and preferred language.
 *
 * API mode: the name goes to `PATCH /auth/me/display-name` and the principal
 * is reloaded; the language goes to `PATCH /auth/me/locale` and then to
 * i18next. Sample mode: the language changes in this browser only and the
 * name form is disabled with the sample note.
 */
import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  Button,
  Field,
  FormErrorSummary,
  Heading,
  Input,
  Select,
  useToast,
} from '@nestself/ui';
import type { FormErrorSummaryHandle } from '@nestself/ui';
import { locales, localeMeta, isLocale } from '@nestself/i18n';
import { DISPLAY_NAME_MAX_LENGTH } from '@nestself/contracts';
import type { Locale } from '@nestself/i18n';
import { useAuth } from '../../auth';
import { accountErrorKey } from './account-errors';
import type { AccountApi } from './use-account';
import { useUpdateDisplayName, useUpdateLocale } from './use-account';

const NAME_ID = 'account-display-name';
const LOCALE_ID = 'account-locale';

export interface AccountSettingsProps {
  authApi: AccountApi;
  /** Sample mode: nothing is sent to the API. */
  sampleMode: boolean;
}

export function AccountSettings({ authApi, sampleMode }: AccountSettingsProps) {
  const { t, i18n } = useTranslation(['auth', 'common']);
  const { principal } = useAuth();
  const { add: addToast } = useToast();
  const updateName = useUpdateDisplayName(authApi);
  const updateLocale = useUpdateLocale(authApi);
  const summaryRef = useRef<FormErrorSummaryHandle>(null);

  // The field shows the saved name until the user types: the principal can
  // arrive after the first render (a deep link or reload of /settings), and
  // a draft initialised from a null principal would stay empty.
  const [draft, setDraft] = useState<string | null>(null);
  const name = draft ?? principal?.displayName ?? '';
  const [nameError, setNameError] = useState<string | null>(null);
  const [localeError, setLocaleError] = useState<string | null>(null);

  if (!principal) return null;

  const failName = (message: string) => {
    setNameError(message);
    queueMicrotask(() => summaryRef.current?.focus());
  };

  const handleNameSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (sampleMode || updateName.isPending) return;
    const trimmed = name.trim();
    if (trimmed.length === 0) return failName(t('auth:account.displayName.required'));
    if (trimmed.length > DISPLAY_NAME_MAX_LENGTH) return failName(t('auth:account.displayName.tooLong'));
    setNameError(null);
    try {
      await updateName.mutateAsync(trimmed);
      setDraft(null);
      addToast({ title: t('auth:account.displayName.saved'), tone: 'success' });
    } catch (err) {
      failName(t(accountErrorKey(err)));
    }
  };

  const handleLocaleChange = async (value: string | null) => {
    if (!value || !isLocale(value)) return;
    setLocaleError(null);
    if (sampleMode) {
      void i18n.changeLanguage(value);
      return;
    }
    try {
      await updateLocale.mutateAsync(value);
      await i18n.changeLanguage(value);
      addToast({ title: t('auth:account.locale.saved'), tone: 'success' });
    } catch (err) {
      setLocaleError(t(accountErrorKey(err)));
    }
  };

  const localeOptions = locales.map((loc: Locale) => ({
    value: loc,
    label: localeMeta[loc].nativeName,
  }));

  const nameErrors = nameError
    ? [{ id: NAME_ID, label: t('auth:account.displayName.label'), message: nameError }]
    : [];

  return (
    <div className="space-y-6">
      {sampleMode ? <Alert tone="info">{t('auth:account.sampleNote')}</Alert> : null}

      <form noValidate onSubmit={(e) => void handleNameSubmit(e)} className="space-y-4 max-w-form">
        <Heading level={3}>
          {t('auth:account.displayName.title')}
        </Heading>
        <FormErrorSummary ref={summaryRef} title={t('common:form.errorSummaryTitle')} errors={nameErrors} />
        <Field
          id={NAME_ID}
          label={t('auth:account.displayName.label')}
          description={t('auth:account.displayName.hint')}
          error={nameError ?? undefined}
          required
        >
          <Input
            name="displayName"
            value={name}
            onChange={(e) => setDraft(e.target.value)}
            disabled={sampleMode}
            autoComplete="name"
          />
        </Field>
        <Button type="submit" disabled={sampleMode || updateName.isPending}>
          {updateName.isPending ? t('auth:account.displayName.saving') : t('auth:account.displayName.save')}
        </Button>
      </form>

      <div className="space-y-3 max-w-form">
        <Field id={LOCALE_ID} label={t('auth:account.locale.label')} error={localeError ?? undefined}>
          <Select
            options={localeOptions}
            value={i18n.resolvedLanguage ?? 'en'}
            onValueChange={(v) => void handleLocaleChange(v)}
            disabled={updateLocale.isPending}
          />
        </Field>
      </div>
    </div>
  );
}
