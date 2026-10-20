import type { Locale } from '@nestself/i18n';
import { isLocale } from '@nestself/i18n';
import { notFound } from 'next/navigation';
import {
  HeroSection,
  SupportSection,
  HowSection,
  LifeSection,
  EmployerSection,
  PrivacySection,
  FooterSection,
} from '@/components/home';

interface Params {
  locale: string;
}

export default async function HomePage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  return (
    <main id="main" tabIndex={-1} className="@container">
      <HeroSection />
      <SupportSection locale={locale as Locale} />
      <HowSection />
      <LifeSection />
      <EmployerSection locale={locale as Locale} />
      <PrivacySection locale={locale as Locale} />
      <FooterSection locale={locale as Locale} />
    </main>
  );
}
