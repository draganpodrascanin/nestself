import { permanentRedirect } from 'next/navigation';
import { localePath } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';

interface Params {
  locale: string;
}

export default async function SupportPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale as Locale, '/services') as any);
}
