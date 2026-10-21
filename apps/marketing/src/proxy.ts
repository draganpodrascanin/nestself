import { type NextRequest, NextResponse } from 'next/server';
import { defaultLocale, isLocale } from '@nestself/i18n';

/**
 * Locale routing. Serbian Latin (the default) lives at the root: `/`, `/plans`.
 * Every other locale is prefixed: `/en/plans`, `/hu`, `/sr-Cyrl/plans`.
 *
 * - `/sr-Latn/...` redirects permanently to the unprefixed path so there is one URL per Serbian page.
 * - A prefixed path for another locale is served as is.
 * - An unprefixed path is served from the `[locale]` tree by an internal rewrite, unless the
 *   visitor chose another language earlier (the `NEXT_LOCALE` cookie the switcher writes), in
 *   which case they are sent to their language. The browser's Accept-Language is deliberately
 *   not consulted: the site is Serbian first, and other languages are an explicit choice.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const [, first = '', ...rest] = pathname.split('/');

  if (first === defaultLocale) {
    const url = request.nextUrl.clone();
    url.pathname = `/${rest.join('/')}`.replace(/\/+$/, '') || '/';
    return NextResponse.redirect(url, 308);
  }

  if (isLocale(first)) {
    return NextResponse.next();
  }

  const cookieLocale = request.cookies.get('NEXT_LOCALE')?.value;
  const suffix = pathname === '/' ? '' : pathname;
  if (cookieLocale && isLocale(cookieLocale) && cookieLocale !== defaultLocale) {
    const url = request.nextUrl.clone();
    url.pathname = `/${cookieLocale}${suffix}`;
    return NextResponse.redirect(url);
  }

  const url = request.nextUrl.clone();
  url.pathname = `/${defaultLocale}${suffix}`;
  return NextResponse.rewrite(url);
}

export const config = {
  matcher: ['/((?!_next|__nextjs|api|images|.*\\..*).*)'],
};
