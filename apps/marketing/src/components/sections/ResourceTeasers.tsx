import { Heading, TextLink } from '@nestself/ui';
import { cn } from '@nestself/ui';
import type { ArticleCardProps } from '../cards/ArticleCard';
import type { WebinarCardProps } from '../cards/WebinarCard';
import type { ToolCardProps } from '../cards/ToolCard';
import { ArticleCard } from '../cards/ArticleCard';
import { WebinarCard } from '../cards/WebinarCard';
import { ToolCard } from '../cards/ToolCard';

export interface ResourceTeasersProps {
  id?: string;
  title: string;
  articles: ArticleCardProps[];
  webinars: WebinarCardProps[];
  tools: ToolCardProps[];
  moreHref: string;
  moreLabel: string;
  className?: string;
}

export function ResourceTeasers({
  id,
  title,
  articles,
  webinars,
  tools,
  moreHref,
  moreLabel,
  className,
}: ResourceTeasersProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('py-16', className)}>
      <div className="mb-8 flex items-baseline justify-between gap-4">
        <Heading level={2} id={headingId}>
          {title}
        </Heading>
        <TextLink href={moreHref} trailingArrow>
          {moreLabel}
        </TextLink>
      </div>
      <div className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1">
        {articles.map((a) => (
          <ArticleCard key={a.href} {...a} />
        ))}
        {webinars.map((w) => (
          <WebinarCard key={w.href} {...w} />
        ))}
        {tools.map((t) => (
          <ToolCard key={t.href} {...t} />
        ))}
      </div>
    </section>
  );
}
