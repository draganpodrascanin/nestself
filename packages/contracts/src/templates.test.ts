import { describe, expect, it } from 'vitest';
import { TEMPLATE_KEYS, PERMISSION_TEMPLATES, REVIEW_DISCIPLINES } from './templates.ts';
import { isAction, CONFIDENTIAL_ACTIONS } from './actions.ts';
import { STEP_UP_CLASS_BY_ACTION } from './authorization.ts';

describe('templates', () => {
  it('TEMPLATE_KEYS has exactly 21 entries', () => {
    expect(TEMPLATE_KEYS).toHaveLength(21);
  });

  it('PERMISSION_TEMPLATES has exactly 21 entries', () => {
    expect(PERMISSION_TEMPLATES).toHaveLength(21);
  });

  it('every template key in PERMISSION_TEMPLATES is unique', () => {
    const keys = PERMISSION_TEMPLATES.map((t) => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every template key appears in TEMPLATE_KEYS', () => {
    const keySet = new Set<string>(TEMPLATE_KEYS);
    for (const t of PERMISSION_TEMPLATES) {
      expect(keySet.has(t.key)).toBe(true);
    }
  });

  it('every TEMPLATE_KEYS entry has a matching PERMISSION_TEMPLATES row', () => {
    const definedKeys = new Set(PERMISSION_TEMPLATES.map((t) => t.key));
    for (const k of TEMPLATE_KEYS) {
      expect(definedKeys.has(k)).toBe(true);
    }
  });

  it('every action in every template is a valid Action', () => {
    for (const t of PERMISSION_TEMPLATES) {
      for (const a of t.actions) {
        expect(isAction(a), `${t.key} contains invalid action "${a}"`).toBe(true);
      }
    }
  });

  it('stepUpActions are subset of template actions or in STEP_UP_CLASS_BY_ACTION', () => {
    for (const t of PERMISSION_TEMPLATES) {
      for (const a of t.stepUpActions) {
        const inTemplate = (t.actions as readonly string[]).includes(a);
        const inGlobal = a in STEP_UP_CLASS_BY_ACTION;
        expect(
          inTemplate || inGlobal,
          `${t.key} stepUpAction "${a}" not in template actions or global step-up table`,
        ).toBe(true);
      }
    }
  });

  it('every template has a valid workspace', () => {
    const validWorkspaces = ['employee', 'organization', 'expert', 'operations'];
    for (const t of PERMISSION_TEMPLATES) {
      expect(validWorkspaces).toContain(t.workspace);
    }
  });

  it('every template has a valid population', () => {
    const validPopulations = ['employee', 'employer_admin', 'expert', 'staff', 'external'];
    for (const t of PERMISSION_TEMPLATES) {
      expect(validPopulations).toContain(t.population);
    }
  });

  it('every template has a valid scopeType', () => {
    const validScopes = [
      'platform', 'organization', 'org_unit', 'assigned_clients',
      'assigned_queues', 'assigned_cases', 'assigned_practice',
      'assigned_collections', 'own',
    ];
    for (const t of PERMISSION_TEMPLATES) {
      expect(validScopes).toContain(t.scopeType);
    }
  });

  it('requiredConditionTypes is a valid condition-type array', () => {
    const validTypes = ['spending_ceiling', 'categories', 'confidential_approver', 'time_window'];
    for (const t of PERMISSION_TEMPLATES) {
      expect(Array.isArray(t.requiredConditionTypes)).toBe(true);
      for (const ct of t.requiredConditionTypes) {
        expect(validTypes, `${t.key} has invalid requiredConditionType "${ct}"`).toContain(ct);
      }
    }
  });

  it('expert template reaches assigned conversations (strategy 4.7.3 assigned-expert path)', () => {
    const expert = PERMISSION_TEMPLATES.find((t) => t.key === 'expert')!;
    expect(expert.scopeType).toBe('assigned_cases');
    expect(expert.actions).toContain('conversation.read.assigned');
    expect(expert.stepUpActions).toContain('conversation.read.assigned');
  });

  it('event actions follow the NS-CALLS-01 templates table (decision record section 7)', () => {
    const actionsOf = (k: string) => [...PERMISSION_TEMPLATES.find((t) => t.key === k)!.actions];
    const holders = (action: string) =>
      PERMISSION_TEMPLATES.filter((t) => (t.actions as readonly string[]).includes(action)).map((t) => t.key);
    expect(holders('event.present')).toEqual(['expert']);
    expect(holders('event.manage').sort()).toEqual(['client_operations', 'content_publisher', 'platform_owner']);
    expect(holders('event.moderate').sort()).toEqual(['client_operations', 'platform_owner', 'service_coordinator']);
    expect(actionsOf('expert')).toEqual(
      expect.arrayContaining(['consultation.join', 'delivery.record', 'appointment.propose', 'event.present']),
    );
    expect(actionsOf('employee')).toEqual(
      expect.arrayContaining(['consultation.join', 'event.register', 'appointment.cancel']),
    );
    expect(actionsOf('support_operator')).toContain('support.troubleshoot');
  });

  it('employer_owner holds access.grant and access.revoke behind step-up (owner model, 2026-10-24)', () => {
    const owner = PERMISSION_TEMPLATES.find((t) => t.key === 'employer_owner')!;
    expect(owner.scopeType).toBe('organization');
    expect(owner.actions).toEqual(expect.arrayContaining([
      'access.grant', 'access.revoke', 'access.delegate', 'access.preview',
    ]));
    expect(owner.stepUpActions).toEqual(expect.arrayContaining([
      'access.grant', 'access.revoke', 'access.delegate',
    ]));
  });

  it('specific templates have the expected requiredConditionTypes', () => {
    const byKey = (k: string) => PERMISSION_TEMPLATES.find((t) => t.key === k)!;
    expect([...byKey('expert').requiredConditionTypes]).toEqual(['categories']);
    expect([...byKey('team_manager').requiredConditionTypes]).toEqual(['spending_ceiling']);
    expect([...byKey('approver').requiredConditionTypes]).toEqual(['spending_ceiling', 'categories']);
    expect([...byKey('employer_finance').requiredConditionTypes]).toEqual(['spending_ceiling']);
    expect([...byKey('event_supplier').requiredConditionTypes]).toEqual(['time_window']);
  });

  it('templates without required conditions have an empty array', () => {
    const withRequired = new Set([
      'expert', 'team_manager', 'approver', 'employer_finance', 'event_supplier',
      'content_reviewer', 'intake_professional',
    ]);
    for (const t of PERMISSION_TEMPLATES) {
      if (!withRequired.has(t.key)) {
        expect(
          t.requiredConditionTypes,
          `${t.key} should have empty requiredConditionTypes`,
        ).toHaveLength(0);
      }
    }
  });

  describe('CMS editorial templates (ACC-R-03)', () => {
    const byKey = (k: string) => PERMISSION_TEMPLATES.find((t) => t.key === k)!;
    const baseline = ['preferences.manage', 'feedback.submit', 'data.export.own', 'data.erasure.request'];

    it('content_author gains media.upload', () => {
      expect(byKey('content_author').actions).toContain('media.upload');
    });

    it('content_publisher cannot review and can preview', () => {
      const publisher = byKey('content_publisher');
      expect(publisher.actions).not.toContain('content.review');
      expect(publisher.actions).toContain('content.preview');
      expect(publisher.actions).toContain('content.publish');
    });

    it('an author cannot publish', () => {
      expect(byKey('content_author').actions).not.toContain('content.publish');
    });

    it('content_reviewer reviews through assigned categories with a categories condition', () => {
      const reviewer = byKey('content_reviewer');
      expect(reviewer.workspace).toBe('operations');
      expect(reviewer.population).toBe('staff');
      expect(reviewer.scopeType).toBe('assigned_collections');
      expect(reviewer.actions).toEqual(['content.review', 'content.preview', ...baseline]);
      expect([...reviewer.requiredConditionTypes]).toEqual(['categories']);
      expect(reviewer.legacyRole).toBeNull();
    });

    it('only the reviewer holds content.review', () => {
      const holders = PERMISSION_TEMPLATES.filter((t) => t.actions.includes('content.review')).map((t) => t.key);
      expect(holders).toEqual(['content_reviewer']);
    });

    it('editorial_lead is platform scoped with the editorial management actions', () => {
      const lead = byKey('editorial_lead');
      expect(lead.workspace).toBe('operations');
      expect(lead.population).toBe('staff');
      expect(lead.scopeType).toBe('platform');
      expect(lead.actions).toEqual([
        'taxonomy.manage', 'home.manage', 'media.manage', 'poll.manage', 'poll.results.read',
        'content.metrics.read', 'editorial.request.manage', 'editorial.brief.manage',
        'content.preview', ...baseline,
      ]);
      expect(lead.legacyRole).toBeNull();
    });

    it('intake templates live in the expert workspace on assigned queues', () => {
      const professional = byKey('intake_professional');
      const lead = byKey('intake_lead');
      for (const t of [professional, lead]) {
        expect(t.workspace).toBe('expert');
        expect(t.population).toBe('expert');
        expect(t.scopeType).toBe('assigned_queues');
        expect(t.legacyRole).toBeNull();
      }
      expect(professional.actions).toEqual(['intake.queue.view', 'intake.claim', ...baseline]);
      expect([...professional.requiredConditionTypes]).toEqual(['categories']);
      expect(lead.actions).toEqual(['intake.queue.view', 'intake.reassign', ...baseline]);
    });

    it('employee gains poll.respond and editorial.request.submit', () => {
      expect(byKey('employee').actions).toEqual(
        expect.arrayContaining(['poll.respond', 'editorial.request.submit']),
      );
    });

    it('expert gains intake.respond and intake.permission.request', () => {
      expect(byKey('expert').actions).toEqual(
        expect.arrayContaining(['intake.respond', 'intake.permission.request']),
      );
      expect(byKey('expert').scopeType).toBe('assigned_cases');
    });
  });

  it('no administrative-scope template lists a confidential action', () => {
    const administrative = [
      'platform', 'organization', 'org_unit', 'assigned_clients', 'assigned_queues',
      'assigned_practice', 'assigned_collections',
    ];
    for (const t of PERMISSION_TEMPLATES) {
      if (!administrative.includes(t.scopeType)) continue;
      for (const a of t.actions) {
        expect(
          (CONFIDENTIAL_ACTIONS as readonly string[]).includes(a),
          `${t.key} (${t.scopeType}) lists confidential action ${a}`,
        ).toBe(false);
      }
    }
  });

  it('REVIEW_DISCIPLINES lists the six review disciplines', () => {
    expect([...REVIEW_DISCIPLINES]).toEqual([
      'psychological', 'legal', 'financial', 'health', 'nutrition', 'general',
    ]);
  });
});
