import type { LeadAccepted } from '@nestself/contracts';

export type LeadResult =
  | { ok: true; data: LeadAccepted }
  | { ok: false; status: number; issues?: { path: (string | number)[]; message: string }[] };

/**
 * Submit a lead form to the Next.js route handler.
 *
 * Network errors return `{ ok: false, status: 0 }`.
 */
export async function submitLead<T>(
  path: 'demo-requests' | 'contact' | 'webinar-registrations',
  body: T,
): Promise<LeadResult> {
  let res: Response;
  try {
    res = await fetch(`/api/leads/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, status: 0 };
  }

  if (res.ok) {
    const data = (await res.json()) as LeadAccepted;
    return { ok: true, data };
  }

  try {
    const json = (await res.json()) as { issues?: { path: (string | number)[]; message: string }[] };
    return { ok: false, status: res.status, issues: json.issues };
  } catch {
    return { ok: false, status: res.status };
  }
}
