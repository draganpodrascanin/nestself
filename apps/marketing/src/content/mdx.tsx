import type { ReactNode, AnchorHTMLAttributes } from 'react';
import { compileMDX } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import { Heading, Text, TextLink } from '@nestself/ui';
import { Callout } from '@/components/content/Callout';
import { Figure } from '@/components/content/Figure';

// ---------------------------------------------------------------------------
// MDX component overrides
// ---------------------------------------------------------------------------

function MdxH2({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <Heading level={2} id={id} className="mt-12 mb-4">
      {children}
    </Heading>
  );
}

function MdxH3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <Heading level={3} id={id} className="mt-8 mb-3">
      {children}
    </Heading>
  );
}

function MdxP({ children }: { children: ReactNode }) {
  return <Text className="mb-4 leading-relaxed">{children}</Text>;
}

/**
 * MDX link override.
 *
 * Internal links use TextLink from @nestself/ui for design-system consistency.
 * External links use a raw <a> because TextLink's API does not support
 * target/rel props needed for external navigation (target="_blank",
 * rel="noopener noreferrer"). The external anchor replicates TextLink's
 * visual classes to keep the same appearance.
 */
function MdxA({
  href,
  children,
  ...rest
}: AnchorHTMLAttributes<HTMLAnchorElement> & { children: ReactNode }) {
  const isExternal = href?.startsWith('http');
  if (isExternal) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary underline underline-offset-[0.2em] hover:text-primary-hover focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-focus"
        {...rest}
      >
        {children}
      </a>
    );
  }
  return <TextLink href={href ?? '#'}>{children}</TextLink>;
}

function MdxUl({ children }: { children: ReactNode }) {
  return <ul className="mb-4 pl-6 space-y-2 list-disc">{children}</ul>;
}

function MdxOl({ children }: { children: ReactNode }) {
  return <ol className="mb-4 pl-6 space-y-2 list-decimal">{children}</ol>;
}

function MdxBlockquote({ children }: { children: ReactNode }) {
  return (
    <blockquote className="my-6 border-l-4 border-border-subtle pl-4 text-text-secondary italic">
      {children}
    </blockquote>
  );
}

const components = {
  h2: MdxH2,
  h3: MdxH3,
  p: MdxP,
  a: MdxA,
  ul: MdxUl,
  ol: MdxOl,
  blockquote: MdxBlockquote,
  Callout,
  Figure,
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Compile and render an MDX source string to React nodes.
 * Uses remark-gfm for tables/strikethrough and rehype-slug for heading ids.
 */
export async function renderMdx(source: string): Promise<ReactNode> {
  const { content } = await compileMDX({
    source,
    components,
    options: {
      mdxOptions: {
        remarkPlugins: [remarkGfm],
        rehypePlugins: [rehypeSlug],
      },
    },
  });
  return content;
}
