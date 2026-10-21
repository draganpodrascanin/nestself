import type { LeadAccepted } from '@nestself/contracts';
import type { FormError } from '@nestself/ui';

export type LeadResult =
  | { ok: true; data: LeadAccepted }
  | { ok: false; status: number; issues?: { path: (string | number)[]; message: string }[] };

/** Validation message templates used by `describeIssues`. */
export interface ValidationMessages {
  required: string;
  email: string;
  consent: string;
  select: string;
  tooLong: string;
}

/** A single zod issue (the subset of fields we inspect). */
export interface ZodIssueSlice {
  code: string;
  path: PropertyKey[];
  format?: string;
}

/**
 * Map raw zod issues to user-friendly `FormError` objects.
 *
 * Mapping rules (by zod v4 issue `code` and `path`):
 * - `too_small` on a string field -> `validation.required`
 * - `invalid_format` with format `email` -> `validation.email`
 * - `invalid_value` on `consent` -> `validation.consent`
 * - `invalid_value` / `invalid_enum_value` on other fields -> `validation.select`
 * - `too_big` -> `validation.tooLong`
 * - anything else -> `validation.required` as fallback
 *
 * `{{field}}` in the template is replaced with the human label.
 */
export function describeIssues(
  issues: ZodIssueSlice[],
  labels: Record<string, string>,
  validation: ValidationMessages,
): FormError[] {
  return issues.map((iss) => {
    const fieldName = String(iss.path[0] ?? 'form');
    const fieldLabel = labels[fieldName] ?? fieldName;
    const fieldId = `field-${fieldName}`;

    let template: string;

    if (fieldName === 'consent' && iss.code === 'invalid_value') {
      template = validation.consent;
    } else if (iss.code === 'invalid_format' && iss.format === 'email') {
      template = validation.email;
    } else if (iss.code === 'too_small') {
      template = validation.required;
    } else if (iss.code === 'too_big') {
      template = validation.tooLong;
    } else if (iss.code === 'invalid_value' || iss.code === 'invalid_enum_value') {
      template = validation.select;
    } else {
      template = validation.required;
    }

    const message = template.replace(/\{\{field\}\}/g, fieldLabel);

    return { id: fieldId, label: fieldLabel, message };
  });
}

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
