import { cn } from '../../../lib/cn';
import { Table, Th, Td } from '../../tables/table';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

/** Minimal shape the helper needs from an event-request object. */
export interface EventRequest {
  participants: number | string;
  location: string;
  options: readonly string[];
}

/** A single row rendered by EventRequestSummary. */
export interface EventRequestRow {
  field: string;
  example: string;
  comparison: string;
}

/** Labels for the row-builder helper (all from the `events.*` catalog). */
export interface EventRequestRowLabels {
  participantsLocation: string;
  datesBudget: string;
  options: string;
  workflow: string;
  exampleDatesBudget: string;
  exampleWorkflow: string;
  compareParticipantsLocation: string;
  compareDatesBudget: string;
  compareOptions: string;
  compareWorkflow: string;
}

/** Column-header labels for the summary table. */
export interface EventRequestSummaryLabels {
  field: string;
  example: string;
  comparison: string;
}

export interface EventRequestSummaryProps {
  rows: EventRequestRow[];
  labels: EventRequestSummaryLabels;
  className?: string;
}

/* ------------------------------------------------------------------ */
/*  Helper: build the four handoff rows from request data + labels    */
/* ------------------------------------------------------------------ */

export function eventRequestRows(
  request: EventRequest,
  labels: EventRequestRowLabels,
): EventRequestRow[] {
  const opts = request.options;
  const first = opts[0] ?? '';
  const optionsText =
    first
      ? first.charAt(0).toUpperCase() + first.slice(1) +
        (opts.length > 1 ? ', ' + opts.slice(1).join(', ') : '')
      : '';

  return [
    {
      field: labels.participantsLocation,
      example: `${request.participants} / ${request.location}`,
      comparison: labels.compareParticipantsLocation,
    },
    {
      field: labels.datesBudget,
      example: labels.exampleDatesBudget,
      comparison: labels.compareDatesBudget,
    },
    {
      field: labels.options,
      example: optionsText,
      comparison: labels.compareOptions,
    },
    {
      field: labels.workflow,
      example: labels.exampleWorkflow,
      comparison: labels.compareWorkflow,
    },
  ];
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function EventRequestSummary({ rows, labels, className }: EventRequestSummaryProps) {
  return (
    <Table className={cn('mt-6', className)}>
      <thead>
        <tr>
          <Th className="bg-tint border-b border-border-subtle">{labels.field}</Th>
          <Th className="bg-tint border-b border-border-subtle">{labels.example}</Th>
          <Th className="bg-tint border-b border-border-subtle">{labels.comparison}</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={row.field}>
            <Td
              className={cn(
                'align-top',
                index < rows.length - 1 && 'border-b border-border-subtle',
              )}
            >
              {row.field}
            </Td>
            <Td
              className={cn(
                'align-top',
                index < rows.length - 1 && 'border-b border-border-subtle',
              )}
            >
              {row.example}
            </Td>
            <Td
              className={cn(
                'align-top',
                index < rows.length - 1 && 'border-b border-border-subtle',
              )}
            >
              {row.comparison}
            </Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
