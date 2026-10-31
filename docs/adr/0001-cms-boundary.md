# ADR 0001: The CMS boundary, the editor, and restricted submissions

**Status:** Accepted, 2026-10-24.
**Context:** Epic `NS-CONTENT-01` (content, discovery and employee requests). Full reasoning in `docs/tasks/cms-ee/cms-ee-strategy.md`, Appendix B (decision record, revision 2).

## Decision

1. **A thin domain CMS inside the platform (C-02).** Content is authored, reviewed and published through NestJS modules in `apps/api` (`cms`, `media`, `library`, `engagement`, `editorial`, `professional`, `notifications`, `reporting`) and screens in `apps/admin`. No headless CMS: it would need a second session, grant, preview, audience and audit integration for no saving at pilot scale.
2. **Tiptap 3 in the admin only; validated JSON; our own renderer (C-03, C-04, C-05).** Documents are ProseMirror-compatible JSON with a closed block catalogue, validated on every write by a Zod schema and by ProseMirror's `Node.fromJSON(...).check()` in Node. Employee screens render the JSON through `@nestself/content/render` components. No HTML string is produced or injected anywhere.
3. **One shared catalogue, personal state per employer (C-07, C-22).** Catalogue tables are platform data; saved items, preferences, votes, requests and questions carry `org_id` with row-level security. The personal context names its organization, and clients clear cached queries on every context switch.
4. **One availability decision (C-10).** `AvailabilityService.availablePublications(ctx)` is the only definition of "available"; every read path, including search counts and every media byte range, composes it.
5. **Every resource in all four languages (C-28).** `sr-Latn`, `hu` and `en` are authored and reviewed; `sr-Cyrl` is generated from the approved `sr-Latn` text at read time with the same transliteration as the interface catalogues. A resource publishes only when all three authored locales are approved.
6. **Restricted submissions stay in the confidential domain (C-17, C-18).** General questions and the free text of editorial requests live in `apps/api/src/professional/`, reachable only by the sender, the professional whose claim created a CASE assignment, or approved emergency access. A lint rule forbids other modules from importing its tables; a test proves no CMS, editorial, reporting or organization response carries an intake field. Publishing a generalized answer needs the sender's permission for the exact text, and the CMS copy keeps no link to the original.

## Consequences

- We maintain revisions, review, scheduling and forms ourselves; the block catalogue and resource types are locked for V1 to keep the CMS small (epic 24.2).
- Content production and review cover three languages per resource.
- Changing any of these decisions means a new revision of the decision record, then this ADR.
