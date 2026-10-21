import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { isLocale } from '@nestself/i18n';
import type { Locale } from '@nestself/i18n';
import { Heading, Text, Table, Th, Td, TextLink, Breadcrumbs } from '@nestself/ui';
import { photos } from '@nestself/assets';
import { localizedMetadata } from '@/i18n/metadata';
import { PageHero } from '@/components/sections';
import { loadContent } from './content';

interface Params { locale: string }

interface PhotoEntry {
  key: string;
  kind?: string;
  author: string;
  source: string;
  license: string;
}

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};
  const { data } = await loadContent(locale as Locale);
  return localizedMetadata({
    locale: locale as Locale,
    title: data.meta.title,
    description: data.meta.description,
    pathname: '/credits',
  });
}

export default async function CreditsPage({ params }: { params: Promise<Params> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const { data } = await loadContent(locale as Locale);

  const allPhotos = photos as PhotoEntry[];
  const generatedPhotos = allPhotos.filter((p) => p.kind === 'generated');
  const pexelsPhotos = allPhotos.filter((p) => p.kind !== 'generated');

  return (
    <main id="main" tabIndex={-1} className="@container">
      <div className="pt-8 pb-4">
        <Breadcrumbs label={data.breadcrumb.label} items={[
          { label: data.breadcrumb.home, href: `/${locale}` },
          { label: data.meta.title },
        ]} />
      </div>

      <PageHero
        title={data.hero.title}
        lead={data.hero.lead}
        primaryCta={{ label: '', href: '' }}
        variant="quiet"
        className="[&_[class*=flex-wrap]]:hidden"
      />

      <section id="generated-imagery" className="pb-12">
        <Heading level={2} typeRole="sectionTitle" className="mb-2">
          {data.generatedImagery.title}
        </Heading>
        <Text tone="secondary" className="mb-6">{data.generatedImagery.lead}</Text>
        <Table caption={data.generatedImagery.tableCaption} density="compact">
          <thead>
            <tr>
              <Th>{data.generatedImagery.colImage}</Th>
              <Th>{data.generatedImagery.colGenerator}</Th>
            </tr>
          </thead>
          <tbody>
            {generatedPhotos.map((p) => (
              <tr key={p.key}>
                <Td>{p.key}</Td>
                <Td>{p.author}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section id="photography" className="pb-12 border-t border-border-subtle pt-8">
        <Heading level={2} typeRole="sectionTitle" className="mb-2">
          {data.photography.title}
        </Heading>
        <Text tone="secondary" className="mb-6">{data.photography.lead}</Text>
        <Table caption={data.photography.tableCaption} density="compact">
          <thead>
            <tr>
              <Th>{data.photography.colPhoto}</Th>
              <Th>{data.photography.colPhotographer}</Th>
              <Th>{data.photography.colSource}</Th>
              <Th>{data.photography.colLicence}</Th>
            </tr>
          </thead>
          <tbody>
            {pexelsPhotos.map((p) => (
              <tr key={p.key}>
                <Td>{p.key}</Td>
                <Td>{p.author}</Td>
                <Td>
                  <TextLink href={p.source}>{data.photography.sourceLinkText}</TextLink>
                </Td>
                <Td>
                  <TextLink href={p.license}>{data.photography.licenceLinkText}</TextLink>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </section>

      <section className="pb-12 border-t border-border-subtle pt-8">
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {data.fonts.title}
        </Heading>
        <Text tone="secondary">{data.fonts.body}</Text>
      </section>

      <section className="pb-16 border-t border-border-subtle pt-8">
        <Heading level={2} typeRole="sectionTitle" className="mb-4">
          {data.icons.title}
        </Heading>
        <Text tone="secondary">{data.icons.body}</Text>
      </section>
    </main>
  );
}
