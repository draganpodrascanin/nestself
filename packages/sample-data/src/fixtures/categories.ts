/**
 * Sample category and label fixtures for the CMS foundation (T-C1.04).
 *
 * Six launch categories with labels in three authored locales (sr-Latn, hu,
 * en). The ids match `SAMPLE_CATEGORY_IDS` from `editorial-staff.ts`.
 */
import { SAMPLE_CATEGORY_IDS } from './editorial-staff.ts';

export interface SampleCategory {
  readonly id: string;
  readonly slug: string;
  readonly sortOrder: number;
}

export interface SampleCategoryLabel {
  readonly id: string;
  readonly categoryId: string;
  readonly locale: 'sr-Latn' | 'hu' | 'en';
  readonly name: string;
  readonly description: string;
}

export const SAMPLE_CATEGORIES: readonly SampleCategory[] = [
  { id: SAMPLE_CATEGORY_IDS.stress, slug: 'stress-and-emotional-balance', sortOrder: 0 },
  { id: SAMPLE_CATEGORY_IDS.sleep, slug: 'sleep-and-rest', sortOrder: 1 },
  { id: SAMPLE_CATEGORY_IDS.relationships, slug: 'relationships-and-family', sortOrder: 2 },
  { id: SAMPLE_CATEGORY_IDS.money, slug: 'money-and-financial-security', sortOrder: 3 },
  { id: SAMPLE_CATEGORY_IDS.work, slug: 'work-and-development', sortOrder: 4 },
  { id: SAMPLE_CATEGORY_IDS.body, slug: 'body-and-everyday-habits', sortOrder: 5 },
];

export const SAMPLE_CATEGORY_LABELS: readonly SampleCategoryLabel[] = [
  // Stress and emotional balance
  { id: 'cl_stress_sr', categoryId: SAMPLE_CATEGORY_IDS.stress, locale: 'sr-Latn', name: 'Stres i emocionalna ravnoteža', description: 'Praktični koraci za upravljanje stresom i jačanje emocionalne otpornosti' },
  { id: 'cl_stress_hu', categoryId: SAMPLE_CATEGORY_IDS.stress, locale: 'hu', name: 'Stressz és érzelmi egyensúly', description: 'Gyakorlati lépések a stresszkezeléshez és az érzelmi ellenállóképesség erősítéséhez' },
  { id: 'cl_stress_en', categoryId: SAMPLE_CATEGORY_IDS.stress, locale: 'en', name: 'Stress and emotional balance', description: 'Practical steps for managing stress and building emotional resilience' },

  // Sleep and rest
  { id: 'cl_sleep_sr', categoryId: SAMPLE_CATEGORY_IDS.sleep, locale: 'sr-Latn', name: 'San i odmor', description: 'Saveti za bolji san i svakodnevnu obnovu energije' },
  { id: 'cl_sleep_hu', categoryId: SAMPLE_CATEGORY_IDS.sleep, locale: 'hu', name: 'Alvás és pihenés', description: 'Tippek a jobb alváshoz és a mindennapi energiafeltöltéshez' },
  { id: 'cl_sleep_en', categoryId: SAMPLE_CATEGORY_IDS.sleep, locale: 'en', name: 'Sleep and rest', description: 'Tips for better sleep and daily energy recovery' },

  // Relationships and family
  { id: 'cl_relationships_sr', categoryId: SAMPLE_CATEGORY_IDS.relationships, locale: 'sr-Latn', name: 'Odnosi i porodica', description: 'Podrška za zdrave odnose i ravnotežu između posla i porodice' },
  { id: 'cl_relationships_hu', categoryId: SAMPLE_CATEGORY_IDS.relationships, locale: 'hu', name: 'Kapcsolatok és család', description: 'Támogatás az egészséges kapcsolatokhoz és a munka-család egyensúlyhoz' },
  { id: 'cl_relationships_en', categoryId: SAMPLE_CATEGORY_IDS.relationships, locale: 'en', name: 'Relationships and family', description: 'Support for healthy relationships and work-family balance' },

  // Money and financial security
  { id: 'cl_money_sr', categoryId: SAMPLE_CATEGORY_IDS.money, locale: 'sr-Latn', name: 'Novac i finansijska sigurnost', description: 'Razumevanje ličnih finansija i koraci ka finansijskoj stabilnosti' },
  { id: 'cl_money_hu', categoryId: SAMPLE_CATEGORY_IDS.money, locale: 'hu', name: 'Pénz és anyagi biztonság', description: 'A személyes pénzügyek megértése és lépések a pénzügyi stabilitás felé' },
  { id: 'cl_money_en', categoryId: SAMPLE_CATEGORY_IDS.money, locale: 'en', name: 'Money and financial security', description: 'Understanding personal finances and steps toward financial stability' },

  // Work and development
  { id: 'cl_work_sr', categoryId: SAMPLE_CATEGORY_IDS.work, locale: 'sr-Latn', name: 'Posao i razvoj', description: 'Veštine i strategije za profesionalni rast i zadovoljstvo na poslu' },
  { id: 'cl_work_hu', categoryId: SAMPLE_CATEGORY_IDS.work, locale: 'hu', name: 'Munka és fejlődés', description: 'Készségek és stratégiák a szakmai fejlődéshez és a munkahelyi elégedettséghez' },
  { id: 'cl_work_en', categoryId: SAMPLE_CATEGORY_IDS.work, locale: 'en', name: 'Work and development', description: 'Skills and strategies for professional growth and job satisfaction' },

  // Body and everyday habits
  { id: 'cl_body_sr', categoryId: SAMPLE_CATEGORY_IDS.body, locale: 'sr-Latn', name: 'Telo i svakodnevne navike', description: 'Male promene u svakodnevici koje grade zdravije navike' },
  { id: 'cl_body_hu', categoryId: SAMPLE_CATEGORY_IDS.body, locale: 'hu', name: 'Test és mindennapi szokások', description: 'Kis mindennapi változtatások, amelyek egészségesebb szokásokat építenek' },
  { id: 'cl_body_en', categoryId: SAMPLE_CATEGORY_IDS.body, locale: 'en', name: 'Body and everyday habits', description: 'Small daily changes that build healthier habits' },
];
