# Building the strategy overview PDF

`docs/tasks/cms-ee/cms-ee-strategy.pdf` is rendered from `cms-ee-strategy.html` with the bundled Chromium of Playwright. The HTML is paginated by hand: every `<section class="page">` is one A4 sheet, and `styles.css` maps the Forest and Mint tokens (`packages/tokens/tokens.css`) and the Onest font (`packages/assets/fonts`) to print. The stylesheet and build script are copies of the ones in `docs/tasks/auth/pdf/`.

```bash
node docs/tasks/cms-ee/pdf/build-pdf.mjs docs/tasks/cms-ee/pdf/cms-ee-strategy.html docs/tasks/cms-ee/cms-ee-strategy.pdf
# optional previews, one PNG per page, and a non-zero exit when any page overflows its sheet:
node docs/tasks/cms-ee/pdf/build-pdf.mjs docs/tasks/cms-ee/pdf/cms-ee-strategy.html docs/tasks/cms-ee/cms-ee-strategy.pdf --png /tmp/cms-ee-pdf-pages
```

Rules when editing the HTML:

- Keep each page inside its fixed height. The build script fails when a page's content is taller than the sheet; shorten text or move content rather than passing `--allow-overflow`.
- Colours come from the CSS variables in `styles.css`, which mirror the token file. Do not add hex literals to the page markup.
- Icons are inline Phosphor SVGs copied from `docs/design-handoff/assets/icons` with `fill="currentColor"`.
- Page numbers in the footers are literal; renumber when pages are added or removed. The cover is page 1 and has no footer.
- Numbers in the PDF (limits, thresholds, periods, counts of decisions and test cases) must match the decision record in Appendix B of `docs/tasks/cms-ee/cms-ee-strategy.md`; change the reference first, then the overview.
