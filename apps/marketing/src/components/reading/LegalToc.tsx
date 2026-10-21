import { Text, TextLink } from '@nestself/ui';

export interface LegalTocSection {
  heading: string;
  id: string;
}

export interface LegalTocProps {
  /** The current page's sections for anchor links. */
  sections: LegalTocSection[];
  /** Other legal documents for cross-linking. */
  otherPages: { label: string; href: string }[];
  /** Heading for the "other legal pages" list. */
  otherPagesHeading: string;
  /** Accessible label for the navigation landmark. */
  navLabel: string;
  /** The id for the nav's heading. */
  navLabelId: string;
}

/** Derives a URL-safe slug from a heading string. */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function LegalToc({
  sections,
  otherPages,
  otherPagesHeading,
  navLabel,
  navLabelId,
}: LegalTocProps) {
  return (
    <nav aria-labelledby={navLabelId} className="sticky top-24">
      <Text as="h2" id={navLabelId} typeRole="label" className="mb-3">
        {navLabel}
      </Text>
      <ul className="list-none m-0 p-0 space-y-2">
        {sections.map((s) => (
          <li key={s.id}>
            <a
              href={`#${s.id}`}
              className="type-metadata text-text-secondary hover:text-primary no-underline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              {s.heading}
            </a>
          </li>
        ))}
      </ul>

      {otherPages.length > 0 && (
        <div className="mt-8 pt-6 border-t border-border-subtle">
          <Text as="h3" typeRole="label" className="mb-3">
            {otherPagesHeading}
          </Text>
          <ul className="list-none m-0 p-0 space-y-2">
            {otherPages.map((p) => (
              <li key={p.href}>
                <TextLink href={p.href} className="type-metadata">
                  {p.label}
                </TextLink>
              </li>
            ))}
          </ul>
        </div>
      )}
    </nav>
  );
}
