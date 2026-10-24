import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS } from '@nestself/contracts';
import { templateLabel } from './access-labels';
import type { AccessT } from './access-labels';

describe('templateLabel', () => {
  it('has a translated label for every template key', () => {
    const t = ((key: string) => key) as unknown as AccessT;
    for (const key of TEMPLATE_KEYS) {
      expect(templateLabel(t, key), key).toBe(`admin:access.templates.${key}`);
    }
  });
});
