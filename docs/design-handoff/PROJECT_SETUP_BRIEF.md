# NestSelf project setup brief

Use this NestSelf Web Handoff as the design source of truth for the project setup.

1. Read README.md, CLAUDE.md, data/tokens.json and styles/tokens.css before building.
2. Preserve the selected default: Forest & Mint, light mode, Onest. Keep all four palettes and both modes available through semantic CSS variables.
3. Use the existing project stack. If this is a new project, set up a minimal maintainable frontend appropriate to the target; keep the design tokens framework-independent. Do not redesign the visual language while scaffolding.
4. Separate marketing, employee and HR surfaces. Keep the reference homepage image-led, with the same hierarchy, real-life photographs and responsive composition.
5. Build components from the documented contracts: buttons, fields, selections, feedback, navigation, dialogs, tables and the booking/coverage patterns. All colour in components must reference the semantic CSS variables. Keep state, size and density variants explicit.
6. Map the supplied local fonts to real weights 400, 600 and 700. Never synthesize italic. Use the original Phosphor SVG family, or its official framework package, with the documented weight rules.
7. Preserve the local image assets, credits and focal-point data. Use responsive production delivery. Stock people must not become named experts, customers or endorsements. Do not infer family eligibility from photographs.
8. Implement accessible keyboard, focus, form errors and announcements. Support reduced motion, 320 px reflow, text scaling, both language scripts and long content.
9. Treat the interactive examples as design demonstrations. Add no fake backend, payments, booked appointments, testimonials, client logos, availability promises or privacy guarantees.
10. Keep sample data visibly separate from production data. Enforce roles on the server when the service is connected; hiding UI is not access control.
11. Add a theme/token smoke check and meaningful component checks for keyboard, form errors and booking price clarity. Verify representative 390 px and 1440 px layouts in the actual browser.
12. Report the created structure, mapping of tokens, checks performed and any still-unimplemented states. Build the project setup first; do not broaden into an entire backend without an explicit brief.
