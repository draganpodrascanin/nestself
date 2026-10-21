import { Eyebrow, Heading, Text } from '@nestself/ui';
import { cn } from '@nestself/ui';

export interface StepsSectionStep {
  title: string;
  body: string;
}

export interface StepsSectionProps {
  id?: string;
  eyebrow?: string;
  title: string;
  steps: StepsSectionStep[];
  className?: string;
}

export function StepsSection({
  id,
  eyebrow,
  title,
  steps,
  className,
}: StepsSectionProps) {
  const headingId = id ? `${id}-title` : undefined;

  return (
    <section id={id} aria-labelledby={headingId} className={cn('py-16', className)}>
      {eyebrow && <Eyebrow className="mb-3">{eyebrow}</Eyebrow>}
      <Heading level={2} id={headingId} className="mb-10">
        {title}
      </Heading>
      <ol className="flex flex-col gap-8">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-6 @max-[760px]:flex-col @max-[760px]:gap-2">
            <Eyebrow numbered className="shrink-0 min-w-[3rem]">
              {String(i + 1).padStart(2, '0')}
            </Eyebrow>
            <div className="flex flex-col gap-2">
              <Heading level={3} typeRole="sectionTitle">
                {step.title}
              </Heading>
              <Text tone="secondary">{step.body}</Text>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
