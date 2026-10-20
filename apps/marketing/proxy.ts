import { type NextRequest, NextResponse } from 'next/server';
import { isLocale, negotiateLocale, parseAcceptLanguage } from '@nestself/i18n';

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Check if the pathname already starts with a supported locale
  const segments = pathname.split('/');
  const firstSegment = segments[1];
  if (firstSegment && isLocale(firstSegment)) {
    return NextResponse.next();
  }

  // Negotiate locale from cookie then Accept-Language header
  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
  let locale: string;

  if (cookieLocale && isLocale(cookieLocale)) {
    locale = cookieLocale;
  } else {
    const acceptLanguage = request.headers.get('Accept-Language') ?? '';
    locale = negotiateLocale(parseAcceptLanguage(acceptLanguage));
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${locale}${pathname}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/((?!_next|api|images|.*\\..*).*)'],
};
