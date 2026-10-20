'use client';

import { useTranslation } from 'react-i18next';
import { photos } from '@nestself/assets';
import { Dialog, DialogTrigger, DialogContent, TextLink, Table, Th, Td } from '@nestself/ui';

export function CreditsDialog({ children }: { children: React.ReactNode }) {
  const { t } = useTranslation(['marketing', 'common']);

  return (
    <Dialog>
      <DialogTrigger className="text-text-secondary hover:text-primary underline underline-offset-[0.2em] type-body cursor-pointer">
        {children}
      </DialogTrigger>
      <DialogContent
        title={t('marketing:credits.title')}
        description={t('marketing:credits.lead')}
        closeLabel={t('common:nav.close')}
        className="max-w-[48rem]"
      >
        <Table caption={t('marketing:credits.dialogCaption')} density="compact">
          <thead>
            <tr>
              <Th>{t('marketing:credits.colPhoto')}</Th>
              <Th>{t('marketing:credits.colPhotographer')}</Th>
              <Th>{t('marketing:credits.colLicence')}</Th>
            </tr>
          </thead>
          <tbody>
            {photos.map((p) => (
              <tr key={p.key}>
                <Td>{p.key}</Td>
                <Td>
                  <TextLink href={p.source}>{p.author}</TextLink>
                </Td>
                <Td>
                  <TextLink href={p.license}>{t('marketing:credits.licence')}</TextLink>
                </Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </DialogContent>
    </Dialog>
  );
}
