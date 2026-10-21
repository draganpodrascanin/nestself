import { permanentRedirect } from 'next/navigation';

interface Params {
  locale: string;
}

export default async function SupportPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/services` as any);
}
