import { permanentRedirect } from 'next/navigation';

interface Params {
  locale: string;
}

export default async function EmployersRedirect({
  params,
}: {
  params: Promise<Params>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/for-employers` as never);
}
