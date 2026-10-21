import { ImageResponse } from 'next/og';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const alt = 'nestself';

export const size = { width: 1200, height: 630 };

export const contentType = 'image/png';

/**
 * Localised OG taglines per locale.
 * TODO: Move to the i18n catalog (marketing:meta.ogTagline) once the
 * translation task (C2) lands the keys in all four locale files.
 */
const taglines: Record<string, string> = {
  en: 'Wellbeing support for your whole team',
  'sr-Latn': 'Podrška blagostanju za ceo vaš tim',
  'sr-Cyrl': 'Подршка благостању за цео ваш тим',
  hu: 'Jólléti támogatás az egész csapatának',
};

// Module-level reads: font and background do not depend on the locale.
const fontData = readFile(
  join(process.cwd(), '../../packages/assets/fonts/native/Onest-Bold.ttf'),
);
const bgData = readFile(
  join(process.cwd(), 'public/images/og-wide/og-wide-1280.jpg'),
);

export default async function OGImage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const tagline = taglines[locale] ?? taglines.en!;

  const [font, bg] = await Promise.all([fontData, bgData]);
  const bgBase64 = `data:image/jpeg;base64,${bg.toString('base64')}`;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
        }}
      >
        {/* Background photo */}
        <img
          src={bgBase64}
          alt=""
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            objectFit: 'cover',
          }}
        />
        {/* Dark gradient overlay */}
        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background:
              'linear-gradient(to right, rgba(0, 0, 0, 0.72) 0%, rgba(0, 0, 0, 0.38) 100%)',
            display: 'flex',
          }}
        />
        {/* Text content */}
        <div
          style={{
            position: 'relative',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            paddingLeft: 80,
            paddingRight: 80,
            height: '100%',
            width: '100%',
          }}
        >
          <div
            style={{
              fontSize: 64,
              fontFamily: 'Onest',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 1)',
              marginBottom: 24,
            }}
          >
            nestself
          </div>
          <div
            style={{
              fontSize: 32,
              fontFamily: 'Onest',
              fontWeight: 700,
              color: 'rgba(255, 255, 255, 0.85)',
            }}
          >
            {tagline}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        {
          name: 'Onest',
          data: font,
          style: 'normal',
          weight: 700,
        },
      ],
    },
  );
}
