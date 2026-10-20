# NestSelf Web Handoff · v0.3

An English, image-led design reference and implementation handoff for NestSelf's proposed employee wellbeing service.

**Start with `index.html`.** Open it in a current browser. The reference uses ordinary HTML, CSS and JavaScript; it needs no build step, account, API key, external font service or network connection. Keep this folder together so the local fonts, photos, CSS and script resolve.

The separate `NestSelf_Design_System.html` deliverable embeds the same assets for convenient one-file review. Give Claude this readable source package rather than asking it to parse the embedded base64 assets in that standalone file.

## What to review

- **Homepage:** a complete visual context for the hero, with family, friendship, caregiving and everyday-life photographs. The 390 px control constrains the homepage container and uses responsive container rules.
- **Design system:** foundations, four palettes, five type families, detailed photography guidance, spacing, grids, dimensions, radii, shadows, icon rules, component states, employee patterns, HR visibility, resilience, accessibility, motion, content and a completeness review.
- **Claude handoff:** a project setup brief and token exports. The brief updates when the palette, mode or font changes.

The default is **Forest & Mint, light mode, Onest**. Other choices are Ink & Ice, Plum & Mist and the newly researched Azure & Sun. Both light and dark semantic values are supplied for every palette.

## Change the whole palette in one place

`styles/tokens.css` is the source for the CSS values. Components in `styles/styles.css` consume semantic custom properties, for example:

```css
.button {
  background: var(--color-primary);
  color: var(--color-on-primary);
  border-radius: var(--radius-control);
}
```

The root chooses a theme and family:

```html
<html lang="en" data-palette="forest" data-mode="light" data-font="onest">
```

Palette IDs: `forest`, `ink`, `plum`, `azure`. Mode IDs: `light`, `dark`. Typeface IDs: `onest`, `commissioner`, `nunito`, `fira`, `lato`.

Use the controls to compare the same compositions. Palette swatches and competitor research samples deliberately retain their own fixed comparison colours; production components use the active theme. The code examples use a system monospace face because they are code.

`data/tokens.json` mirrors the values and component contracts in a project-specific JSON schema. It does not claim full DTCG compatibility. `semanticRoles` maps the earlier semantic names to the CSS variable names used here. Keep CSS and JSON together when editing; the creation checks compared all eight theme blocks; see the QA report.

## File map

- `index.html`: readable structure, all three views, inline SVG symbol definitions and reference data.
- `styles/tokens.css`: semantic colour themes and shared space, type, radius, motion and layer tokens.
- `styles/fonts.css`: local real font files mapped to weights 400 / 600 / 700 and supported real italics.
- `styles/styles.css`: responsive layout and component styling.
- `scripts/app.js`: local theme/font controls, navigation, exports, form states, dialog hooks, booking and chat demonstrations.
- `data/tokens.json`: tokens and implementation contracts.
- `data/contrast-report.json`: 120 independently computed sRGB pair checks.
- `data/font-audit.json`: original font file, feature and Serbian glyph checks.
- `data/photo-sources.json`: original photo URLs, photographers and licence/status metadata.
- `data/sources.json`: primary design, typography, icon, accessibility, image and competitor-style sources.
- `data/qa-report.json`: completed checks and their limits.
- `assets/photos/`: optimised images used in the reference, not an unrelated stock library.
- `assets/fonts/`: WOFF2 files and OFL licences.
- `assets/icons/`: original Phosphor SVG subset and MIT licence; Iconoir alternatives are comparison assets with their own licence.
- `CLAUDE.md`: project setup constraints.
- `PROJECT_SETUP_BRIEF.md`: the implementation prompt.

## Decisions updated from v0.2

The default has changed to Forest & Mint at the user's request. Cream and beige page canvases remain excluded. The public site is now distinctly image-led: one lead family scene plus two supporting moments is permitted in the hero. This intentionally replaces the earlier one-photo-first-screen limit for the public website. Sensitive product tasks and HR data keep their calmer imagery rules.

The public hero now has its own fluid 64 / 70 desktop and 40 / 46 mobile type starting point. Product and native type scales remain documented separately. All five candidates are sans families; a serif is not part of the default system.

Azure & Sun is an original proposal informed by the broad blue-plus-lively-accent pattern observed in current Modern Health and Headspace stylesheets. The reference records observed competitor values separately from NestSelf's values. It does not copy a complete competitor palette or claim a universal colour psychology.

## Photography and licences

Photos are used as conceptual lifestyle imagery. The people shown are not NestSelf customers, experts, endorsers or evidence of service outcomes. Family imagery does not establish benefit eligibility for family members. Real expert profiles must use the actual approved expert; initials are the fallback.

Each photograph links to its original Pexels page and photographer in the reference and source metadata. The optimised files are included specifically for this design and its implementation. Do not redistribute them as a separate stock collection. Check the original licence and any additional permissions for the intended production use.

No photo colour filter is applied. Preserve natural skin tones, meaningful gestures and the story during responsive cropping. Store focal points and approval metadata in the production CMS. The source reference uses JPEG for portability; build responsive WebP/AVIF delivery with fallback and real quality checks in the production project.

The selected Phosphor icons are MIT-licensed. Iconoir is an alternative comparison, not a second production family. Streamline remains a researched commercial option; no paid Streamline asset is supplied as a production icon. Font licences are preserved beside the files.

## What is local and illustrative

There is no connected service, authentication, real appointment availability, payment, message delivery, employee database or backend. The interactions illustrate design behaviour. Sample advisor names, dates, amounts and HR figures are fictional. The privacy matrix is a proposed access model, not a live privacy notice or proof of enforcement.

The working wordmark and name are not final brand identity. A final logo, actual expert photography, user testing, product-wide accessibility review, native-device verification, local crisis pathway, video calling, export/print details and contractual coverage/cancellation rules remain production work.

## Validation

The source is checked for HTML asset resolution, unique IDs, all SVG symbol references, image alt/dimensions, CSS syntax, defined variables and CSS/JSON theme agreement. The 120 proposed colour pairs pass their text or control thresholds. DOM tests exercise all themes and fonts, routing, invalid-form recovery, selection, booking cost clarity, chat retry and local file initialisation.

**Visual browser QA was unavailable in this session.** The managed preview workflow requires a browser-control capability that was not available, so no alternate browser or preview server was started. DOM emulation does not prove CSS layout, native focus trapping, real device typography, screen reader behaviour or downloads. Review representative 390 px and 1440 px layouts in the actual target browser before a production release.
