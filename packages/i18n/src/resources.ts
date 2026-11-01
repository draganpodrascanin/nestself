import type { Namespace } from './types';

import enAdmin from '../locales/en/admin.json';
import enAuth from '../locales/en/auth.json';
import enCalls from '../locales/en/calls.json';
import enCommon from '../locales/en/common.json';
import enMarketing from '../locales/en/marketing.json';
import enMobile from '../locales/en/mobile.json';
import enWorkspace from '../locales/en/workspace.json';
import enLibrary from '../locales/en/library.json';
import enCms from '../locales/en/cms.json';
import enListening from '../locales/en/listening.json';
import srCyrlAdmin from '../locales/sr-Cyrl/admin.json';
import srCyrlAuth from '../locales/sr-Cyrl/auth.json';
import srCyrlCalls from '../locales/sr-Cyrl/calls.json';
import srCyrlCommon from '../locales/sr-Cyrl/common.json';
import srCyrlMarketing from '../locales/sr-Cyrl/marketing.json';
import srCyrlMobile from '../locales/sr-Cyrl/mobile.json';
import srCyrlWorkspace from '../locales/sr-Cyrl/workspace.json';
import srCyrlLibrary from '../locales/sr-Cyrl/library.json';
import srCyrlCms from '../locales/sr-Cyrl/cms.json';
import srCyrlListening from '../locales/sr-Cyrl/listening.json';
import huAdmin from '../locales/hu/admin.json';
import huAuth from '../locales/hu/auth.json';
import huCalls from '../locales/hu/calls.json';
import huCommon from '../locales/hu/common.json';
import huMarketing from '../locales/hu/marketing.json';
import huMobile from '../locales/hu/mobile.json';
import huWorkspace from '../locales/hu/workspace.json';
import huLibrary from '../locales/hu/library.json';
import huCms from '../locales/hu/cms.json';
import huListening from '../locales/hu/listening.json';
import srLatnAdmin from '../locales/sr-Latn/admin.json';
import srLatnAuth from '../locales/sr-Latn/auth.json';
import srLatnCalls from '../locales/sr-Latn/calls.json';
import srLatnCommon from '../locales/sr-Latn/common.json';
import srLatnMarketing from '../locales/sr-Latn/marketing.json';
import srLatnMobile from '../locales/sr-Latn/mobile.json';
import srLatnWorkspace from '../locales/sr-Latn/workspace.json';
import srLatnLibrary from '../locales/sr-Latn/library.json';
import srLatnCms from '../locales/sr-Latn/cms.json';
import srLatnListening from '../locales/sr-Latn/listening.json';

export const resources = {
  en: {
    common: enCommon,
    marketing: enMarketing,
    workspace: enWorkspace,
    admin: enAdmin,
    mobile: enMobile,
    auth: enAuth,
    library: enLibrary,
    cms: enCms,
    calls: enCalls,
    listening: enListening,
  },
  'sr-Latn': {
    common: srLatnCommon,
    marketing: srLatnMarketing,
    workspace: srLatnWorkspace,
    admin: srLatnAdmin,
    mobile: srLatnMobile,
    auth: srLatnAuth,
    library: srLatnLibrary,
    cms: srLatnCms,
    calls: srLatnCalls,
    listening: srLatnListening,
  },
  'sr-Cyrl': {
    common: srCyrlCommon,
    marketing: srCyrlMarketing,
    workspace: srCyrlWorkspace,
    admin: srCyrlAdmin,
    mobile: srCyrlMobile,
    auth: srCyrlAuth,
    library: srCyrlLibrary,
    cms: srCyrlCms,
    calls: srCyrlCalls,
    listening: srCyrlListening,
  },
  hu: {
    common: huCommon,
    marketing: huMarketing,
    workspace: huWorkspace,
    admin: huAdmin,
    mobile: huMobile,
    auth: huAuth,
    library: huLibrary,
    cms: huCms,
    calls: huCalls,
    listening: huListening,
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
