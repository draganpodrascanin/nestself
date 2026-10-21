# Building the strategy overview PDF

`docs/tasks/auth/auth-strategy.pdf` is rendered from `auth-strategy.html` with the bundled Chromium of Playwright. The HTML is paginated by hand: every `<section class="page">` is one A4 sheet, and `styles.css` maps the Forest and Mint tokens (`packages/tokens/tokens.css`) and the Onest font (`packages/assets/fonts`) to print.

```bash
node docs/tasks/auth/pdf/build-pdf.mjs docs/tasks/auth/pdf/auth-strategy.html docs/tasks/auth/auth-strategy.pdf
# optional previews, one PNG per page, and a non-zero exit when any page overflows its sheet:
node docs/tasks/auth/pdf/build-pdf.mjs docs/tasks/auth/pdf/auth-strategy.html docs/tasks/auth/auth-strategy.pdf --png /tmp/auth-pdf-pages
```

Rules when editing the HTML:

- Keep each page inside its fixed height. The build script fails when a page's content is taller than the sheet; shorten text or move content rather than passing `--allow-overflow`.
- Colours come from the CSS variables in `styles.css`, which mirror the token file. Do not add hex literals to the page markup.
- Icons are inline Phosphor SVGs copied from `docs/design-handoff/assets/icons` with `fill="currentColor"`.
- Page numbers in the footers are literal; renumber when pages are added or removed. The cover is page 1 and has no footer.
- Numbers in the PDF (lifetimes, costs, phases) must match the decision record in `docs/tasks/auth/auth-strategy.md`; change the reference first, then the overview.
