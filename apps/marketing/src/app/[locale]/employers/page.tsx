import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { getServerT } from '@/i18n/server';
import { localizedMetadata } from '@/i18n/metadata';
import { EmployersPageContent } from './employers-content';

interface Params { locale: string }

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { t } = await getServerT(locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: t('marketing:pages.employers.title'),
    description: t('marketing:pages.employers.lead'),
    pathname: '/employers',
  });
}

export default async function EmployersPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return <EmployersPageContent />;
}
