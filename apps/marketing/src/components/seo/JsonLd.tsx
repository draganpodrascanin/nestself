export interface JsonLdProps {
  data: Record<string, unknown>;
}

/**
 * Renders a `<script type="application/ld+json">` tag with the given
 * structured data.  `<` is escaped as `<` to prevent XSS via
 * embedded `</script>` sequences.
 */
export function JsonLd({ data }: JsonLdProps) {
  const json = JSON.stringify(data).replaceAll('<', '\\u003c');
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
