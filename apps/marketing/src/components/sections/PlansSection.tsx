import { Heading, Text, LinkButton, Card } from '@nestself/ui';
import { cn } from '@nestself/ui';

export interface PlansTier {
  name: string;
  audience: string;
  includes: string[];
  cta: { label: string; href: string };
}

export interface PlansSectionProps {
  id?: string;
  title?: string;
  tiers: PlansTier[];
  note: string;
  className?: string;
}

export function PlansSection({ id, title, tiers, note, className }: PlansSectionProps) {
  const headingId = id && title ? `${id}-title` : undefined;
  return (
    <section id={id} aria-labelledby={headingId} className={cn('py-16', className)}>
      {title && (
        <Heading level={2} id={headingId} className="mb-8">
          {title}
        </Heading>
      )}
      <ul
        role="list"
        className="grid gap-8 grid-cols-3 @max-[760px]:grid-cols-1"
      >
        {tiers.map((tier) => (
          <li key={tier.name}>
            <Card padding="lg" className="flex h-full flex-col">
              <Heading level={3} typeRole="sectionTitle">
                {tier.name}
              </Heading>
              <Text tone="secondary" className="mt-2">
                {tier.audience}
              </Text>
              <ul className="mt-4 flex flex-col gap-2 pl-5 list-disc flex-1">
                {tier.includes.map((item, i) => (
                  <li key={i} className="type-body text-text-secondary">
                    {item}
                  </li>
                ))}
              </ul>
              <div className="mt-6">
                <LinkButton href={tier.cta.href} fullWidth>
                  {tier.cta.label}
                </LinkButton>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      <Text tone="secondary" typeRole="metadata" className="mt-6 text-center">
        {note}
      </Text>
    </section>
  );
}
