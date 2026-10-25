/**
 * CMS create article route (WRK-R-30, T-C1.12).
 *
 * Form to create a new article resource with primary category, review
 * discipline, initial language and title.
 */
import { createFileRoute, redirect, useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { can, AUTHORED_LOCALES } from '@nestself/contracts';
import {
  Heading,
  Button,
  Field,
  Input,
  Select,
  FormErrorSummary,
  useToast,
} from '@nestself/ui';
import {
  SAMPLE_CATEGORIES,
  SAMPLE_CATEGORY_LABELS,
} from '@nestself/sample-data';
import { isSampleDataMode } from '../../../../data-source';

const REVIEW_DISCIPLINES = [
  'psychological',
  'legal',
  'financial',
  'health',
  'nutrition',
  'general',
] as const;

function NewResourcePage() {
  const { t, i18n } = useTranslation(['cms', 'common']);
  const navigate = useNavigate();
  const toast = useToast();

  const locale = i18n.language;

  const [categoryId, setCategoryId] = useState<string>('');
  const [discipline, setDiscipline] = useState<string>('general');
  const [initialLocale, setInitialLocale] = useState<string>('sr-Latn');
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState<Array<{ id: string; label: string; message: string }>>([]);

  const categoryOptions = SAMPLE_CATEGORIES.map((cat) => {
    const label = SAMPLE_CATEGORY_LABELS.find(
      (cl) => cl.categoryId === cat.id && cl.locale === (locale === 'sr-Cyrl' ? 'sr-Latn' : locale),
    );
    return { value: cat.id, label: label?.name ?? cat.slug };
  });

  const disciplineOptions = REVIEW_DISCIPLINES.map((d) => ({
    value: d,
    label: t(`cms:newResource.disciplines.${d}`),
  }));

  const localeOptions = AUTHORED_LOCALES.map((l) => ({
    value: l,
    label: t(`cms:detail.locale.${l}`),
  }));

  const validate = (): boolean => {
    const errs: typeof errors = [];
    if (!categoryId) {
      errs.push({
        id: 'category',
        label: t('cms:newResource.category'),
        message: t('cms:editor.validation.titleRequired'),
      });
    }
    if (!title.trim()) {
      errs.push({
        id: 'title',
        label: t('cms:newResource.initialTitle'),
        message: t('cms:editor.validation.titleRequired'),
      });
    }
    if (title.length > 200) {
      errs.push({
        id: 'title',
        label: t('cms:newResource.initialTitle'),
        message: t('cms:editor.validation.titleTooLong'),
      });
    }
    setErrors(errs);
    return errs.length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    if (isSampleDataMode) {
      toast.add({ title: t('cms:sample.saveNotice'), tone: 'info' });
      void navigate({ to: '/cms/resources' });
      return;
    }

    setSubmitting(true);
    try {
      // API mode: createCmsApi(api).createResource(...)
      // For now, the API client is being implemented by a parallel fork.
      // This will be wired when the API client is available.
      toast.add({ title: t('cms:newResource.success'), tone: 'success' });
      void navigate({ to: '/cms/resources' });
    } catch (err) {
      const code = (err as { code?: string }).code ?? 'unknown';
      const message = t(`cms:error.${code}`, { defaultValue: t('cms:error.unknown') });
      setErrors([{ id: 'form', label: t('cms:newResource.title'), message }]);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-xl">
      <Heading level={1}>{t('cms:newResource.title')}</Heading>

      {errors.length > 0 ? (
        <FormErrorSummary
          title={t('cms:editor.validation.title')}
          errors={errors}
          className="mt-4"
        />
      ) : null}

      <form onSubmit={handleSubmit} className="mt-6 flex flex-col gap-6">
        <Field label={t('cms:newResource.category')} required id="category">
          <Select
            options={categoryOptions}
            placeholder={t('cms:newResource.categoryPlaceholder')}
            value={categoryId}
            onValueChange={(v) => setCategoryId(v ?? '')}
          />
        </Field>

        <Field label={t('cms:newResource.reviewDiscipline')} id="discipline">
          <Select
            options={disciplineOptions}
            value={discipline}
            onValueChange={(v) => setDiscipline(v ?? 'general')}
          />
        </Field>

        <Field label={t('cms:newResource.locale')} id="locale">
          <Select
            options={localeOptions}
            value={initialLocale}
            onValueChange={(v) => setInitialLocale(v ?? 'sr-Latn')}
          />
        </Field>

        <Field label={t('cms:newResource.initialTitle')} required id="title">
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={t('cms:newResource.initialTitlePlaceholder')}
          />
        </Field>

        <div>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            loadingLabel={t('common:loading')}
          >
            {t('cms:newResource.submit')}
          </Button>
        </div>
      </form>
    </div>
  );
}

export const Route = createFileRoute('/_authenticated/cms/resources/new')({
  beforeLoad: ({ context }) => {
    const { principal, effectiveActions } = context.auth;
    if (!principal || !can(principal, 'content.write', undefined, effectiveActions)) {
      throw redirect({ to: '/cms/resources' });
    }
  },
  component: NewResourcePage,
});
