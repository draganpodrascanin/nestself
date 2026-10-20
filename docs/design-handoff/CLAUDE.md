# NestSelf implementation source of truth

Read `README.md`, `PROJECT_SETUP_BRIEF.md`, `data/tokens.json` and `styles/tokens.css` first. This package defines design decisions and contains reference examples. Preserve its hierarchy and image-led public direction while making a maintainable project setup.

## Visual contracts

- Default: `forest` palette, `light` mode, `onest` family. Preserve all four palettes and both modes as variable sets.
- Palette values belong in the semantic token layer. Components reference `var(--color-...)`, never copied palette hex literals. Research swatches are comparison material, not component values.
- Keep marketing, employee and HR surface density distinct. Public photography is generous; forms, chat, payments and HR reports remain task-focused.
- Use real font weights 400, 600 and 700. Use the supplied local files and licences. Do not synthesize italic; Onest has no delivered italic.
- Phosphor is the production family: Regular controls, Fill active navigation, Duotone support categories. Use accessible labels and minimum interaction targets.
- Preserve the layout, control padding, spacing, radii, shadows, motion and layer contracts. Min-height means minimum, not a fixed clipping box.
- Use rem for scalable web type/space. Native tokens are starting values in pt / dp / sp and require real platform adapters, not copied web CSS.

## Photos and content

- Use the supplied photos as lifestyle imagery, with the credit and licence metadata. Do not label a stock person as an expert, customer or endorser.
- Family photographs do not imply household eligibility, child therapy or coverage not confirmed by the service model.
- Production expert portraits require the actual approved person. Use initials until the real asset exists.
- No beige overlay, heavy skin colour grade, invented statistics, customer logos, testimonials, availability promises or outcomes.
- Preserve focal points. Build responsive image delivery and review faces, gestures and text placement at narrow and wide sizes.
- Keep marketing copy distinct from implementation notes. Do not put these developer instructions inside the consumer flow.

## Behaviour and access

- Implement keyboard and focus rules, error association, useful status announcements, text scaling and reduced motion.
- A dialog needs native/accessible focus containment and return focus; verify this in a real browser.
- Booking shows service price, employer coverage, employee payment, time zone and actual change terms before commitment.
- Server-side availability and price are checked again at final confirmation. No optimistic success for payment or bookings.
- HR aggregates do not expose an individual's support history. Enforce permissions server-side; CSS visibility is not protection.
- Keep draft content on failure and avoid duplicates on retry. Protected data is not zero, and offline is not empty.
- Examples are local demonstrations. Do not turn sample names, amounts or approvals into production data.

## Scope of the first implementation pass

Create project structure, token loading, local assets, reusable primitives, the marketing reference composition and representative component/pattern previews. Use an existing stack if supplied. Keep the design layer framework-independent. Do not add an entire backend or real transactions without a separate brief.

Run appropriate checks and inspect 390 px and 1440 px in an actual browser. The creation session's DOM checks did not verify layout or native dialog focus trapping. Record any deviation and unimplemented state clearly.
