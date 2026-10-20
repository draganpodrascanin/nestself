import { redirect } from 'next/navigation';
import { headers, cookies } from 'next/headers';
import { isLocale, negotiateLocale, parseAcceptLanguage } from '@nestself/i18n';

export default async function RootPage() {
  const cookieStore = await cookies();
  const headerStore = await headers();

  const cookieLocale = cookieStore.get('NEXT_LOCALE')?.value;
  let locale: string;

  if (cookieLocale && isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLanguage = headerStore.get('Accept-Language') ?? '';
    locale = negotiateLocale(parseAcceptLanguage(acceptLanguage));
  }

  redirect(`/${locale}`);
}
