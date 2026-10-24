import { MARKETING_URL } from '../../ports';
import type { PageEntry } from '../../pages';

export const pages: PageEntry[] = [
  { name: 'marketing-resources', url: `${MARKETING_URL}/resources`, locale: 'sr-Latn' },
  { name: 'marketing-resources-en', url: `${MARKETING_URL}/en/resources` },
  { name: 'marketing-resources-hu', url: `${MARKETING_URL}/hu/resources`, locale: 'hu' },
  { name: 'marketing-webinars', url: `${MARKETING_URL}/webinars`, locale: 'sr-Latn' },
  { name: 'marketing-webinars-en', url: `${MARKETING_URL}/en/webinars` },
  { name: 'marketing-webinars-hu', url: `${MARKETING_URL}/hu/webinars`, locale: 'hu' },
  { name: 'marketing-webinar-detail', url: `${MARKETING_URL}/webinars/recognising-workplace-stress`, locale: 'sr-Latn' },
  { name: 'marketing-articles', url: `${MARKETING_URL}/articles`, locale: 'sr-Latn' },
  { name: 'marketing-articles-en', url: `${MARKETING_URL}/en/articles` },
  { name: 'marketing-articles-hu', url: `${MARKETING_URL}/hu/articles`, locale: 'hu' },
  { name: 'marketing-article-detail', url: `${MARKETING_URL}/articles/signs-of-burnout-first-steps`, locale: 'sr-Latn' },
  { name: 'marketing-article-detail-en', url: `${MARKETING_URL}/en/articles/signs-of-burnout-first-steps` },
  { name: 'marketing-article-detail-hu', url: `${MARKETING_URL}/hu/articles/signs-of-burnout-first-steps`, locale: 'hu' },
];
