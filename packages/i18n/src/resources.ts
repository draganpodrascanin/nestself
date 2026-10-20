import type { Namespace } from './types';

import enAdmin from '../locales/en/admin.json';
import enCommon from '../locales/en/common.json';
import enMarketing from '../locales/en/marketing.json';
import enMobile from '../locales/en/mobile.json';
import enWorkspace from '../locales/en/workspace.json';
import srCyrlAdmin from '../locales/sr-Cyrl/admin.json';
import srCyrlCommon from '../locales/sr-Cyrl/common.json';
import srCyrlMarketing from '../locales/sr-Cyrl/marketing.json';
import srCyrlMobile from '../locales/sr-Cyrl/mobile.json';
import srCyrlWorkspace from '../locales/sr-Cyrl/workspace.json';
import srLatnAdmin from '../locales/sr-Latn/admin.json';
import srLatnCommon from '../locales/sr-Latn/common.json';
import srLatnMarketing from '../locales/sr-Latn/marketing.json';
import srLatnMobile from '../locales/sr-Latn/mobile.json';
import srLatnWorkspace from '../locales/sr-Latn/workspace.json';

export const resources = {
  en: {
    common: enCommon,
    marketing: enMarketing,
    workspace: enWorkspace,
    admin: enAdmin,
    mobile: enMobile,
  },
  'sr-Latn': {
    common: srLatnCommon,
    marketing: srLatnMarketing,
    workspace: srLatnWorkspace,
    admin: srLatnAdmin,
    mobile: srLatnMobile,
  },
  'sr-Cyrl': {
    common: srCyrlCommon,
    marketing: srCyrlMarketing,
    workspace: srCyrlWorkspace,
    admin: srCyrlAdmin,
    mobile: srCyrlMobile,
  },
} as const;

/**
 * Returns a subset of resources filtered to the given namespaces.
 * Useful when an app only needs certain namespaces (e.g., workspace + common).
 */
export function resourcesFor(ns: Namespace[]) {
  const nsSet = new Set<string>(ns);
  const result: Record<string, Record<string, unknown>> = {};

  for (const [locale, namespaces] of Object.entries(resources)) {
    result[locale] = {};
    for (const [nsKey, value] of Object.entries(namespaces)) {
      if (nsSet.has(nsKey)) {
        result[locale]![nsKey] = value;
      }
    }
  }

  return result;
}
