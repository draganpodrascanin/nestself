import { useId, useState } from 'react';
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
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Text,
  Textarea,
} from '@nestself/ui';
import type { FormError } from '@nestself/ui';
import type { QuestionnaireDraftRequest, QuestionnaireVersionResponse } from '@nestself/contracts';
import { transliterate } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { WORDING_LOCALES, localeLabel } from './localized';
import { QuestionnairePreview } from './questionnaire-preview';

type TextField = 'question' | 'scaleLow' | 'scaleHigh' | 'explanation';
const TEXT_FIELDS: readonly TextField[] = ['question', 'scaleLow', 'scaleHigh', 'explanation'];
/** The contract's limits (`LocalizedTextSchema`, `LocalizedLongTextSchema`). */
const MAX_TEXT = 500;
const MAX_NOTICE = 5000;
const NONE = 'none';

export interface QuestionnaireEditorProps {
  title: string;
  initial: QuestionnaireDraftRequest;
  /** Published versions a draft may declare itself comparable with. */
  publishedVersions: readonly QuestionnaireVersionResponse[];
  /** A published or archived version: the wording is shown, nothing can be saved. */
  readOnly?: boolean;
  pending?: boolean;
  /** A refused save, already translated. */
  error?: string | null;
  onSave: (body: QuestionnaireDraftRequest) => void;
  onClose: () => void;
}

/**
 * Edits one questionnaire version: the five questions with their scale
 * labels and employer explanation, per language, plus the privacy notice and
 * the published version the draft stays comparable with. Only wording is
 * editable (spec 4.1 and SUR-01): the dimension keys, the 1 to 5 scale and
 * the scoring are fixed by the contract and are not on this form. Every
 * language must be filled before a draft is saved; Cyrillic can be filled
 * from the Latin wording and then corrected. The preview beside the form
 * renders the draft as an employee will read it.
 */
export function QuestionnaireEditor({ title, initial, publishedVersions, readOnly = false, pending = false, error = null, onSave, onClose }: QuestionnaireEditorProps) {
  const { t } = useTranslation(['listening', 'common']);
  const idPrefix = useId();
  const [draft, setDraft] = useState<QuestionnaireDraftRequest>(initial);
  const [locale, setLocale] = useState<Locale>('sr-Latn');
  const [errors, setErrors] = useState<FormError[]>([]);
  const [filledCyrillic, setFilledCyrillic] = useState(false);

  const fieldId = (owner: string, field: TextField | 'notice', l: Locale) => `${idPrefix}-${owner}-${field}-${l}`;
  const fieldLabel = (field: TextField | 'notice') => t(`listening:questionnaires.editor.${field}`);
  const errorFor = (id: string) => errors.find((e) => e.id === id)?.message;

  const setText = (index: number, field: TextField, l: Locale, value: string) =>
    setDraft((d) => ({
      ...d,
      dimensions: d.dimensions.map((dim, i) => (i === index ? { ...dim, [field]: { ...dim[field], [l]: value } } : dim)),
    }));
  const setNotice = (l: Locale, value: string) => setDraft((d) => ({ ...d, notice: { ...d.notice, [l]: value } }));

  const fillCyrillic = () => {
    setDraft((d) => ({
      ...d,
      notice: { ...d.notice, 'sr-Cyrl': transliterate(d.notice['sr-Latn']) },
      dimensions: d.dimensions.map((dim) => ({
        ...dim,
        question: { ...dim.question, 'sr-Cyrl': transliterate(dim.question['sr-Latn']) },
        scaleLow: { ...dim.scaleLow, 'sr-Cyrl': transliterate(dim.scaleLow['sr-Latn']) },
        scaleHigh: { ...dim.scaleHigh, 'sr-Cyrl': transliterate(dim.scaleHigh['sr-Latn']) },
        explanation: { ...dim.explanation, 'sr-Cyrl': transliterate(dim.explanation['sr-Latn']) },
      })),
    }));
    setFilledCyrillic(true);
  };

  /** Every language, every text: present and within the contract's length. The first problem's language becomes the open tab. */
  const validate = (): { problems: FormError[]; firstLocale: Locale | null } => {
    const problems: FormError[] = [];
    let firstLocale: Locale | null = null;
    for (const l of WORDING_LOCALES) {
      const language = localeLabel(l);
      const check = (id: string, field: TextField | 'notice', value: string, max: number) => {
        const label = fieldLabel(field);
        let message: string | null = null;
        if (!value.trim()) message = t('listening:questionnaires.editor.required', { field: label, language });
        else if (value.length > max) message = t('listening:questionnaires.editor.tooLong', { field: label, language, max });
        if (!message) return;
        firstLocale ??= l;
        problems.push({ id, label: `${label} (${language})`, message });
      };
      check(fieldId('notice', 'notice', l), 'notice', draft.notice[l], MAX_NOTICE);
      draft.dimensions.forEach((dim) => TEXT_FIELDS.forEach((f) => check(fieldId(dim.key, f, l), f, dim[f][l], MAX_TEXT)));
    }
    return { problems, firstLocale };
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (readOnly || pending) return;
    const { problems, firstLocale } = validate();
    setErrors(problems);
    if (problems.length > 0) {
      if (firstLocale) setLocale(firstLocale);
      return;
    }
    onSave(draft);
  };

  const comparableOptions = [
    { value: NONE, label: t('listening:questionnaires.editor.comparableNone') },
    ...publishedVersions.map((v) => ({ value: v.id, label: t('listening:questionnaires.version', { version: v.version }) })),
  ];

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <form onSubmit={handleSubmit} noValidate className="space-y-6" aria-labelledby={`${idPrefix}-title`}>
        <Heading level={2} typeRole="sectionTitle" id={`${idPrefix}-title`}>
          {title}
        </Heading>
        {readOnly ? <Alert tone="info">{t('listening:questionnaires.editor.readOnly')}</Alert> : null}
        {error ? <Alert tone="danger">{error}</Alert> : null}
        {errors.length > 0 ? <FormErrorSummary title={t('listening:questionnaires.editor.errorsTitle')} errors={errors} /> : null}

        <Field label={t('listening:questionnaires.editor.comparableWith')} description={t('listening:questionnaires.editor.comparableHint')} id={`${idPrefix}-comparable`}>
          <Select
            options={comparableOptions}
            value={draft.comparableWithVersionId ?? NONE}
            onValueChange={(v) => setDraft((d) => ({ ...d, comparableWithVersionId: v && v !== NONE ? v : null }))}
            disabled={readOnly}
          />
        </Field>

        <Tabs value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <TabList label={t('listening:questionnaires.editor.languages')}>
            {WORDING_LOCALES.map((l) => (
              <Tab key={l} value={l}>
                {localeLabel(l)}
              </Tab>
            ))}
          </TabList>
          {WORDING_LOCALES.map((l) => (
            <TabPanel key={l} value={l} className="space-y-6 pt-4">
              {l === 'sr-Cyrl' && !readOnly ? (
                <div className="space-y-2">
                  <Button variant="secondary" size="sm" type="button" onClick={fillCyrillic}>
                    {t('listening:questionnaires.editor.fillCyrillic')}
                  </Button>
                  {filledCyrillic ? (
                    <Text tone="secondary" typeRole="metadata" role="status">
                      {t('listening:questionnaires.editor.fillCyrillicDone')}
                    </Text>
                  ) : null}
                </div>
              ) : null}
              <Field
                label={fieldLabel('notice')}
                description={t('listening:questionnaires.editor.noticeHint')}
                id={fieldId('notice', 'notice', l)}
                error={errorFor(fieldId('notice', 'notice', l))}
                required
              >
                <Textarea value={draft.notice[l]} onChange={(e) => setNotice(l, e.target.value)} readOnly={readOnly} rows={6} />
              </Field>
              {draft.dimensions.map((dim, index) => (
                <fieldset key={dim.key} className="space-y-4 rounded-card border border-border-subtle p-4">
                  <legend className="type-label text-text px-1">{t(`listening:dimensions.${dim.key}.title`)}</legend>
                  {TEXT_FIELDS.map((field) => (
                    <Field key={field} label={fieldLabel(field)} id={fieldId(dim.key, field, l)} error={errorFor(fieldId(dim.key, field, l))} required>
                      {field === 'explanation' ? (
                        <Textarea value={dim[field][l]} onChange={(e) => setText(index, field, l, e.target.value)} readOnly={readOnly} rows={3} />
                      ) : (
                        <Input value={dim[field][l]} onChange={(e) => setText(index, field, l, e.target.value)} readOnly={readOnly} maxLength={MAX_TEXT} />
                      )}
                    </Field>
                  ))}
                </fieldset>
              ))}
            </TabPanel>
          ))}
        </Tabs>

        <div className="flex flex-wrap gap-3">
          {readOnly ? null : (
            <Button variant="primary" type="submit" disabled={pending}>
              {pending ? t('listening:questionnaires.editor.saving') : t('listening:questionnaires.editor.save')}
            </Button>
          )}
          <Button variant="secondary" type="button" onClick={onClose} disabled={pending}>
            {t('listening:questionnaires.editor.close')}
          </Button>
        </div>
      </form>
      <QuestionnairePreview dimensions={draft.dimensions} notice={draft.notice} />
    </div>
  );
}
