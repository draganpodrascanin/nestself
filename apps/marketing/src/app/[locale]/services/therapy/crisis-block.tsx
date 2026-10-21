import { Alert } from '@nestself/ui';
import { Heading, Text } from '@nestself/ui';
import { Phone } from '@phosphor-icons/react/dist/ssr';

interface CrisisLine {
  label: string;
  value: string;
}

interface CrisisCountry {
  country: string;
  items: CrisisLine[];
}

export interface CrisisBlockProps {
  title: string;
  body: string;
  lines: CrisisCountry[];
}

export function CrisisBlock({ title, body, lines }: CrisisBlockProps) {
  return (
    <section id="crisis" aria-label={title} className="py-16">
      <Alert tone="danger" title={title} icon={<Phone size={24} weight="duotone" />}>
        <Text className="mb-4">{body}</Text>
        <div className="gap-6 grid grid-cols-2 @max-[760px]:grid-cols-1">
          {lines.map((country) => (
            <div key={country.country}>
              <Heading level={3} typeRole="sectionTitle" className="mb-2">
                {country.country}
              </Heading>
              <ul className="gap-1 flex flex-col">
                {country.items.map((line) => (
                  <li key={`${line.label}-${line.value}`} className="gap-2 flex items-baseline">
                    <Text typeRole="label">{line.label}:</Text>
                    <a
                      href={`tel:${line.value.replace(/\s/g, '')}`}
                      className="type-body font-[var(--font-weight-label)] underline"
                    >
                      {line.value}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Alert>
    </section>
  );
}
