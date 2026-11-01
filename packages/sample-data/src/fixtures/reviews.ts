/**
 * Workplace review fixtures for sample mode (ADR 0002, spec Epics G and H):
 * what the workspace and admin screens show when `VITE_DATA_SOURCE=sample`.
 * Fictional values with the shape of the API responses they stand in for; the
 * fixture test parses each with its contract schema. The sample organization
 * has one converted request whose engagement has a shared report and an
 * agreed action, so every state of the journey is visible.
 */
import type {
  ImprovementActionView,
  ReviewEngagementResponse,
  ReviewPackResponse,
  ReviewQueueResponse,
  ReviewReportView,
  ReviewRequestOpsResponse,
  ReviewRequestResponse,
  ReviewScopeView,
  ReviewServicesResponse,
  ReviewerCandidatesResponse,
} from '@nestself/contracts';
import { SAMPLE_LISTENING_HEATMAP, SAMPLE_SNAPSHOT_CURRENT_ID } from './listening.ts';
import { SAMPLE_ORG } from './org.ts';

export const SAMPLE_REVIEW_SERVICE_ID = 'review_service_workplace_review';
export const SAMPLE_INTRO_SERVICE_ID = 'review_service_introductory_call';
export const SAMPLE_REVIEW_REQUEST_ID = 'review_request_sample_1';
export const SAMPLE_REVIEW_SCOPE_ID = 'review_scope_sample_1';
export const SAMPLE_REVIEW_ENGAGEMENT_ID = 'review_engagement_sample_1';
export const SAMPLE_REVIEW_GRANT_ID = 'review_grant_sample_1';
export const SAMPLE_REVIEW_REPORT_ID = 'review_report_sample_1';
export const SAMPLE_REVIEW_ACTION_ID = 'improvement_action_sample_1';

export const SAMPLE_REVIEW_SERVICES: ReviewServicesResponse = {
  workplaceReviewsEnabled: true,
  items: [
    {
      id: SAMPLE_REVIEW_SERVICE_ID,
      key: 'workplace_review',
      name: { en: 'Workplace review', 'sr-Latn': 'Pregled radnog okruženja', 'sr-Cyrl': 'Преглед радног окружења', hu: 'Munkahelyi átvilágítás' },
      description: {
        en: 'A qualified reviewer assesses the shared results with you and writes a report with findings and practical proposals. Scoped and priced per request.',
        'sr-Latn': 'Kvalifikovani stručnjak sa vama procenjuje podeljene rezultate i piše izveštaj sa nalazima i praktičnim predlozima. Obim i cena se određuju po zahtevu.',
        'sr-Cyrl': 'Квалификовани стручњак са вама процењује подељене резултате и пише извештај са налазима и практичним предлозима. Обим и цена се одређују по захтеву.',
        hu: 'Egy képzett átvilágító Önnel együtt értékeli a megosztott eredményeket, és jelentést ír megállapításokkal és gyakorlati javaslatokkal. A terjedelem és az ár kérésenként kerül meghatározásra.',
      },
      durationMinutes: 90,
      priceMinor: null,
      currency: 'EUR',
      introductory: false,
      termsVersion: '2026-11',
      termsText: {
        en: 'Professional services are scoped and quoted per request; a quote binds once accepted by an authorized approver. Cancellation follows the quoted policy.',
        'sr-Latn': 'Stručne usluge se definišu i nude po zahtevu; ponuda postaje obavezujuća kada je prihvati ovlašćeni odobravalac. Otkazivanje prati navedenu politiku.',
        'sr-Cyrl': 'Стручне услуге се дефинишу и нуде по захтеву; понуда постаје обавезујућа када је прихвати овлашћени одобравалац. Отказивање прати наведену политику.',
        hu: 'A szakmai szolgáltatások terjedelme és ára kérésenként kerül meghatározásra; az ajánlat a jogosult jóváhagyó elfogadásával válik kötelezővé. A lemondás az ajánlatban rögzített szabályt követi.',
      },
      pricing: 'quote',
    },
    {
      id: SAMPLE_INTRO_SERVICE_ID,
      key: 'introductory_call',
      name: { en: 'Introductory call', 'sr-Latn': 'Uvodni razgovor', 'sr-Cyrl': 'Уводни разговор', hu: 'Bevezető beszélgetés' },
      description: {
        en: 'A free 30-minute call to understand the results and the next steps. No report and no commitment.',
        'sr-Latn': 'Besplatan razgovor od 30 minuta o rezultatima i sledećim koracima. Bez izveštaja i bez obaveze.',
        'sr-Cyrl': 'Бесплатан разговор од 30 минута о резултатима и следећим корацима. Без извештаја и без обавезе.',
        hu: 'Ingyenes 30 perces beszélgetés az eredményekről és a következő lépésekről. Jelentés és kötelezettség nélkül.',
      },
      durationMinutes: 30,
      priceMinor: 0,
      currency: 'EUR',
      introductory: true,
      termsVersion: '2026-11',
      termsText: {
        en: 'The introductory call is free of charge and creates no obligation.',
        'sr-Latn': 'Uvodni razgovor je besplatan i ne stvara obavezu.',
        'sr-Cyrl': 'Уводни разговор је бесплатан и не ствара обавезу.',
        hu: 'A bevezető beszélgetés díjmentes, és nem jár kötelezettséggel.',
      },
      pricing: 'free',
    },
  ],
};

const SCOPE: ReviewScopeView = {
  id: SAMPLE_REVIEW_SCOPE_ID,
  version: 1,
  status: 'accepted',
  serviceId: SAMPLE_REVIEW_SERVICE_ID,
  title: 'Workload review, company scope',
  deliverables: 'A 90-minute assessment meeting with the HR lead and the department heads, and a written report with findings and prioritized proposals.',
  participants: 'HR lead, two department heads, one NestSelf workplace reviewer',
  priceMinor: 120000,
  currency: 'EUR',
  taxNote: 'Excluding VAT',
  termsVersion: '2026-11',
  validUntil: '2026-11-15T09:00:00.000Z',
  cancellationPolicy: 'Free cancellation up to 48 hours before the meeting; later cancellations are charged in full.',
  sentAt: '2026-10-24T10:00:00.000Z',
  acceptedAt: '2026-10-25T08:30:00.000Z',
};

export const SAMPLE_REVIEW_REQUEST: ReviewRequestResponse = {
  id: SAMPLE_REVIEW_REQUEST_ID,
  status: 'converted',
  scopeCohortKey: 'company',
  dimensionKeys: ['sustainable_workload'],
  snapshotIds: [SAMPLE_SNAPSHOT_CURRENT_ID],
  serviceId: SAMPLE_REVIEW_SERVICE_ID,
  shareAggregates: true,
  context: 'Workload complaints have grown since the spring reorganization.',
  termsVersion: '2026-11',
  noticeVersion: '2026-11',
  createdAt: '2026-10-23T09:00:00.000Z',
  coordinatorFirstName: 'Nikola',
  declineReason: null,
  informationRequest: null,
  informationAnswer: null,
  scopes: [SCOPE],
  engagementId: SAMPLE_REVIEW_ENGAGEMENT_ID,
};

export const SAMPLE_REVIEW_REQUESTS: ReviewRequestResponse[] = [SAMPLE_REVIEW_REQUEST];

const PARAGRAPH = (text: string) => ({ type: 'doc', schemaVersion: 1, content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] });

export const SAMPLE_REVIEW_REPORT: ReviewReportView = {
  id: SAMPLE_REVIEW_REPORT_ID,
  version: 1,
  status: 'shared',
  sections: {
    context: PARAGRAPH('A 160-person organization in two departments, four months after a reorganization that merged two engineering teams.'),
    evidence: PARAGRAPH('The October survey shows 48.0 percent favorable on sustainable workload at company level; the other four dimensions are good or to be monitored.'),
    findings: PARAGRAPH('Rota changes reach the engineering teams with less than a day of notice, and overtime is not tracked per team.'),
    uncertainties: PARAGRAPH('Whether the pattern holds in the commercial department is not known: too few people answered this dimension there.'),
    proposals: PARAGRAPH('Publish the rota two weeks ahead, agree an overtime ceiling per team, and repeat the measurement after two cycles.'),
  },
  evidenceSnapshotIds: [SAMPLE_SNAPSHOT_CURRENT_ID],
  authorFirstName: 'Milica',
  sharedAt: '2026-11-05T14:00:00.000Z',
  updatedAt: '2026-11-05T14:00:00.000Z',
};

const ACTION: ImprovementActionView = {
  id: SAMPLE_REVIEW_ACTION_ID,
  title: 'Publish the rota two weeks ahead',
  description: 'The rota for the following month is fixed and published on the first working day of the month.',
  status: 'agreed',
  ownerUserId: 'user_stefan',
  ownerFirstName: 'Stefan',
  dueDate: '2026-12-01T00:00:00.000Z',
  intendedCheck: 'Sustainable workload favorable share in the next two cycles, and no rota change with under a week of notice.',
  dimensionKey: 'sustainable_workload',
  reportVersionId: SAMPLE_REVIEW_REPORT_ID,
  proposedBy: 'reviewer',
  agreedAt: '2026-11-06T09:00:00.000Z',
  completedAt: null,
  notProceedingReason: null,
  createdAt: '2026-11-05T14:05:00.000Z',
};

export const SAMPLE_REVIEW_ENGAGEMENT: ReviewEngagementResponse = {
  id: SAMPLE_REVIEW_ENGAGEMENT_ID,
  orgId: SAMPLE_ORG.id,
  requestId: SAMPLE_REVIEW_REQUEST_ID,
  status: 'report_shared',
  scope: SCOPE,
  scopeCohortKey: 'company',
  dimensionKeys: ['sustainable_workload'],
  reviewerFirstName: 'Milica',
  coordinatorFirstName: 'Nikola',
  appointment: { id: 'appointment_review_sample', startsAt: '2026-11-03T09:00:00.000Z', endsAt: '2026-11-03T10:30:00.000Z', timeZone: 'Europe/Belgrade', status: 'completed' },
  proposedWindows: null,
  proposedTimeZone: null,
  sharingGrants: [
    {
      id: SAMPLE_REVIEW_GRANT_ID,
      snapshotIds: [SAMPLE_SNAPSHOT_CURRENT_ID],
      cohortKeys: ['company', 'ou_engineering', 'ou_commercial'],
      validUntil: null,
      revokedAt: null,
      createdAt: '2026-10-26T08:00:00.000Z',
      active: true,
    },
  ],
  sharedReport: SAMPLE_REVIEW_REPORT,
  actions: [ACTION],
  followUp: null,
  completedAt: null,
  canceledAt: null,
  cancelReason: null,
  createdAt: '2026-10-25T08:30:00.000Z',
};

/** A fresh engagement awaiting a booking: the coordinator proposed two windows. */
export const SAMPLE_REVIEW_ENGAGEMENT_PENDING: ReviewEngagementResponse = {
  ...SAMPLE_REVIEW_ENGAGEMENT,
  id: 'review_engagement_sample_2',
  requestId: 'review_request_sample_2',
  status: 'accepted',
  scope: { ...SCOPE, id: 'review_scope_sample_2', serviceId: SAMPLE_INTRO_SERVICE_ID, title: 'Introductory call', priceMinor: 0, taxNote: null },
  scopeCohortKey: 'ou_engineering',
  appointment: null,
  proposedWindows: [
    { startsAt: '2026-11-18T08:00:00.000Z', endsAt: '2026-11-18T08:30:00.000Z' },
    { startsAt: '2026-11-19T13:00:00.000Z', endsAt: '2026-11-19T13:30:00.000Z' },
  ],
  proposedTimeZone: 'Europe/Belgrade',
  sharingGrants: [],
  sharedReport: null,
  actions: [],
  createdAt: '2026-11-01T10:00:00.000Z',
};

export const SAMPLE_REVIEW_ENGAGEMENTS: ReviewEngagementResponse[] = [SAMPLE_REVIEW_ENGAGEMENT, SAMPLE_REVIEW_ENGAGEMENT_PENDING];

export const SAMPLE_REVIEW_PACK: ReviewPackResponse = {
  engagementId: SAMPLE_REVIEW_ENGAGEMENT_ID,
  grants: SAMPLE_REVIEW_ENGAGEMENT.sharingGrants,
  snapshots: [
    {
      snapshotId: SAMPLE_SNAPSHOT_CURRENT_ID,
      cycleOpensAt: '2026-10-15T07:00:00.000Z',
      cycleClosesAt: '2026-10-22T07:00:00.000Z',
      questionnaireVersion: 1,
      rows: SAMPLE_LISTENING_HEATMAP.rows,
    },
  ],
};

export const SAMPLE_REVIEW_QUEUE: ReviewQueueResponse = {
  items: [
    {
      id: 'review_request_sample_3',
      orgId: SAMPLE_ORG.id,
      organizationName: SAMPLE_ORG.name,
      status: 'submitted',
      scopeCohortKey: 'ou_commercial',
      dimensionKeys: ['manager_support'],
      snapshotCount: 1,
      shareAggregates: false,
      requesterFirstName: 'Ivana',
      coordinatorFirstName: null,
      coordinatorUserId: null,
      createdAt: '2026-10-29T08:00:00.000Z',
      dueAt: '2026-11-02T08:00:00.000Z',
      overdue: true,
      engagementId: null,
    },
    {
      id: SAMPLE_REVIEW_REQUEST_ID,
      orgId: SAMPLE_ORG.id,
      organizationName: SAMPLE_ORG.name,
      status: 'converted',
      scopeCohortKey: 'company',
      dimensionKeys: ['sustainable_workload'],
      snapshotCount: 1,
      shareAggregates: true,
      requesterFirstName: 'Ivana',
      coordinatorFirstName: 'Nikola',
      coordinatorUserId: 'user_nikola',
      createdAt: '2026-10-23T09:00:00.000Z',
      dueAt: '2026-10-27T09:00:00.000Z',
      overdue: false,
      engagementId: SAMPLE_REVIEW_ENGAGEMENT_ID,
    },
  ],
};

export const SAMPLE_REVIEW_REQUEST_OPS: ReviewRequestOpsResponse = {
  ...SAMPLE_REVIEW_REQUEST,
  orgId: SAMPLE_ORG.id,
  organizationName: SAMPLE_ORG.name,
  requesterFirstName: 'Ivana',
  coordinatorUserId: 'user_nikola',
};

export const SAMPLE_REVIEW_REQUEST_OPS_NEW: ReviewRequestOpsResponse = {
  ...SAMPLE_REVIEW_REQUEST_OPS,
  id: 'review_request_sample_3',
  status: 'submitted',
  scopeCohortKey: 'ou_commercial',
  dimensionKeys: ['manager_support'],
  shareAggregates: false,
  context: null,
  coordinatorFirstName: null,
  coordinatorUserId: null,
  scopes: [],
  engagementId: null,
  createdAt: '2026-10-29T08:00:00.000Z',
};

export const SAMPLE_REVIEWER_CANDIDATES: ReviewerCandidatesResponse = { items: [{ userId: 'user_milica', displayName: 'Milica Radović' }] };
