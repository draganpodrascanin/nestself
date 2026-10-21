import { Heading, Text, LinkButton } from '@nestself/ui';
import { cn } from '@nestself/ui';

export interface CtaBandCta {
  label: string;
  href: string;
}

export interface CtaBandProps {
  id?: string;
  title: string;
  body?: string;
  primary: CtaBandCta;
  secondary?: CtaBandCta;
  className?: string;
}

export function CtaBand({ id, title, body, primary, secondary, className }: CtaBandProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        'rounded-card bg-primary px-8 py-12 text-center @max-[760px]:px-5 @max-[760px]:py-8',
        className,
      )}
    >
      <Heading level={2} id={headingId} className="text-on-primary">
        {title}
      </Heading>
      {body && (
        <Text className="mt-3 text-on-primary opacity-90">
          {body}
        </Text>
      )}
      <div className="mt-6 flex flex-wrap items-center justify-center gap-4 @max-[760px]:flex-col @max-[760px]:[&>*]:w-full">
        <LinkButton href={primary.href} variant="on-brand">
          {primary.label}
        </LinkButton>
        {secondary && (
          <LinkButton href={secondary.href} variant="on-brand-outline">
            {secondary.label}
          </LinkButton>
        )}
      </div>
    </section>
  );
}
