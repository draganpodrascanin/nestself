import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Badge, Button, Heading, Text } from '@nestself/ui';
import type { BadgeTone } from '@nestself/ui';
import { can } from '@nestself/contracts';
import type { OrgUnitResponse } from '@nestself/contracts';
import type { OrgAdminApi } from '@nestself/api-client';
import { useAuth } from '../../auth';
import { sampleOrgUnits } from '../people/sample-people';
import { useOrgContext } from '../people/use-org-context';
import { useOrgUnitList } from '../org/use-org-units';
import { OrgUnitDialog } from './org-unit-dialogs';
import type { OrgUnitAction } from './org-unit-dialogs';
import { orgUnitErrorKey } from './org-units-errors';
import { flattenTree, isMovable } from './org-unit-tree';

const KIND_TONE: Record<OrgUnitResponse['kind'], BadgeTone> = {
  COMPANY: 'info',
  DEPARTMENT: 'neutral',
  TEAM: 'success',
};

export interface OrgUnitsScreenProps {
  adminApi: OrgAdminApi;
  /** Sample mode: fixtures instead of the API, and every mutation disabled. */
  sampleMode: boolean;
}

/**
 * The organization's unit tree (built from the flat list) with rename, add
 * child and move, all under `org_units.manage`. The root COMPANY unit cannot
 * be moved; the server refuses it and cycles again.
 */
export function OrgUnitsScreen({ adminApi, sampleMode }: OrgUnitsScreenProps) {
  const { t } = useTranslation(['workspace', 'common']);
  const { principal, effectiveActions } = useAuth();
  const { orgId, apiOrgId, switchError } = useOrgContext(sampleMode);
  const query = useOrgUnitList(adminApi, apiOrgId);
  const [action, setAction] = useState<OrgUnitAction | null>(null);
  const canManage = principal ? can(principal, 'org_units.manage', undefined, effectiveActions) : false;

  const header = (
    <div className="space-y-2">
      <Heading level={1}>{t('workspace:orgUnits.title')}</Heading>
      <Text tone="secondary">{t('workspace:orgUnits.lead')}</Text>
    </div>
  );

  if (!principal || orgId === null) {
    return (
      <div className="space-y-6">
        {header}
        <Alert tone="info">{t('workspace:orgUnits.noOrganization')}</Alert>
      </div>
    );
  }

  const units = sampleMode ? sampleOrgUnits(orgId) : query.data?.filter((u) => u.archivedAt === null);
  const loadError = sampleMode
    ? null
    : switchError
      ? (orgUnitErrorKey(switchError) ?? 'unknown')
      : query.isError
        ? (orgUnitErrorKey(query.error) ?? 'unknown')
        : null;

  return (
    <div className="space-y-8">
      {header}

      {sampleMode ? <Alert tone="info">{t('workspace:orgUnits.sampleNote')}</Alert> : null}

      {loadError ? (
        <Alert tone="danger" title={t('workspace:orgUnits.errors.loadTitle')}>
          {t(`workspace:orgUnits.errors.${loadError}`)}
        </Alert>
      ) : units === undefined ? (
        <Text tone="secondary">{t('workspace:orgUnits.loading')}</Text>
      ) : units.length === 0 ? (
        <Text tone="secondary">{t('workspace:orgUnits.empty')}</Text>
      ) : (
        <ul aria-label={t('workspace:orgUnits.treeLabel')} className="divide-y divide-border-subtle rounded-card border border-border-subtle bg-surface">
          {flattenTree(units).map(({ unit, depth }) => (
            <li
              key={unit.id}
              data-org-unit-id={unit.id}
              data-depth={depth}
              className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
            >
              <div className="flex items-center gap-3" style={{ paddingInlineStart: `${depth * 1.5}rem` }}>
                <span className="type-label text-text">{unit.name}</span>
                <Badge tone={KIND_TONE[unit.kind]}>{t(`workspace:orgUnits.kinds.${unit.kind}`)}</Badge>
              </div>
              {canManage ? (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={sampleMode}
                    aria-label={t('workspace:orgUnits.rename.openFor', { name: unit.name })}
                    onClick={() => setAction({ kind: 'rename', unit })}
                  >
                    {t('workspace:orgUnits.rename.open')}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={sampleMode}
                    aria-label={t('workspace:orgUnits.addChild.openFor', { name: unit.name })}
                    onClick={() => setAction({ kind: 'addChild', unit })}
                  >
                    {t('workspace:orgUnits.addChild.open')}
                  </Button>
                  {isMovable(unit) ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={sampleMode}
                      aria-label={t('workspace:orgUnits.move.openFor', { name: unit.name })}
                      onClick={() => setAction({ kind: 'move', unit })}
                    >
                      {t('workspace:orgUnits.move.open')}
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && !sampleMode && units ? (
        <OrgUnitDialog action={action} onClose={() => setAction(null)} adminApi={adminApi} orgId={orgId} units={units} />
      ) : null}
    </div>
  );
}
