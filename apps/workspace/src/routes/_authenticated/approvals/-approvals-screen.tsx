/**
 * The approver's dashboard of follow-up approval items (T-CW-1.10, D-CW-37,
 * CALL-36). Each item shows four facts only: the employee's name, "follow-up
 * session with a NestSelf expert", the date and time, and the duration. The
 * server sends nothing else (CW-R-119) and the client schema refuses more.
 *
 * Approve is one click; decline opens a dialog for the short reason the
 * employee will see (1 to 300 characters, checked here and on the server).
 * Every failure is translated copy on screen: a load or approve failure in an
 * alert, a decline failure inside the dialog next to the reason. The server
 * decides who may decide (`approval.decide`, the approver or the alternate,
 * the self-approval rule); hiding this route is a convenience only.
 *
 * `approval.decide` is not in the step-up class map, so the calls are not
 * wrapped in `withStepUp`.
 */
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDialog,
  AlertDialogContent,
  Badge,
  Button,
  Card,
  Field,
  FormErrorSummary,
  Heading,
  StatusBlock,
  Textarea,
  useToast,
} from '@nestself/ui';
import type { BadgeTone, FormError } from '@nestself/ui';
import {
  ApiError,
  approvalKeys,
  approvalListQuery,
  approveApprovalMutation,
  rejectApprovalMutation,
} from '@nestself/api-client';
import type { CallsApi } from '@nestself/api-client';
import { APPROVAL_SAFE_REASON_MAX_LENGTH, stripControlCharacters } from '@nestself/contracts';
import type { AppointmentApprovalItem, AppointmentApprovalStatus } from '@nestself/contracts';
import type { TFunction } from 'i18next';
import { useAuth } from '../../../auth';
import { formatZonedDate, formatZonedTime } from '../../../calls/format';
import { mapCallError } from '../../../calls/map-call-error';

type CallsT = TFunction<'calls'>;

const REASON_ID = 'approval-reject-reason';

const STATUS_TONE: Readonly<Record<AppointmentApprovalStatus, BadgeTone>> = {
  pending: 'warning',
  approved: 'success',
  rejected: 'neutral',
  expired: 'neutral',
};

/** Translated copy for a failed approval call; `self_approval_denied` has its own message. */
function mapApprovalError(err: unknown, t: CallsT): string {
  if (err instanceof ApiError && err.code === 'self_approval_denied') return t('approval.errors.selfApprovalDenied');
  return mapCallError(err, t);
}

/** The reader's own time zone: the item carries no zone (it is not one of the four facts). */
function readerTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

interface ItemProps {
  item: AppointmentApprovalItem;
  onApprove?: (item: AppointmentApprovalItem) => void;
  onReject?: (item: AppointmentApprovalItem) => void;
  approving?: boolean;
  disabled?: boolean;
}

function ApprovalCard({ item, onApprove, onReject, approving = false, disabled = false }: ItemProps) {
  const { t, i18n } = useTranslation('calls');
  const language = i18n.resolvedLanguage ?? i18n.language;
  const zone = readerTimeZone();
  const date = formatZonedDate(item.startsAt, zone, language);
  const time = formatZonedTime(item.startsAt, zone, language);
  return (
    <Card as="li">
      <div className="gap-4 flex flex-wrap items-start justify-between">
        <div className="gap-1 min-w-0 flex flex-col">
          <Heading level={3} className="type-label text-text">
            {item.employeeDisplayName}
          </Heading>
          <p className="type-body text-text">{t('approval.followUpLabel')}</p>
          <p className="type-body text-text-secondary">{t('approval.when', { date, time })}</p>
          <p className="type-metadata text-text-secondary">{t('approval.duration', { count: item.durationMinutes })}</p>
        </div>
        <Badge tone={STATUS_TONE[item.status]}>{t(`approval.${item.status}`)}</Badge>
      </div>
      {item.status === 'pending' && onApprove && onReject ? (
        <div className="mt-4 gap-3 flex flex-wrap">
          <Button onClick={() => onApprove(item)} loading={approving} disabled={disabled && !approving}>
            {t('approval.approve')}
          </Button>
          <Button variant="secondary" onClick={() => onReject(item)} disabled={disabled}>
            {t('approval.reject')}
          </Button>
        </div>
      ) : null}
    </Card>
  );
}

interface RejectDialogProps {
  /**
   * The item being declined; it stays set after the dialog closes, so the
   * title and the name keep their text through the exit animation (Motion
   * rule). `open` alone decides whether the dialog is shown.
   */
  item: AppointmentApprovalItem | null;
  open: boolean;
  api: CallsApi;
  onClose: () => void;
  onRejected: (item: AppointmentApprovalItem) => void;
}

function RejectApprovalDialog({ item, open, api, onClose, onRejected }: RejectDialogProps) {
  const { t } = useTranslation(['calls', 'common']);
  const reject = useMutation(rejectApprovalMutation(api));
  const formRef = useRef<HTMLFormElement>(null);
  /** The confirm button also asks the dialog to close; that request is ignored while a decline runs. */
  const confirming = useRef(false);
  const [errors, setErrors] = useState<FormError[]>([]);

  const close = () => {
    setErrors([]);
    reject.reset();
    onClose();
  };

  const fail = (message: string) => setErrors([{ id: REASON_ID, label: t('calls:approval.reasonLabel'), message }]);

  const confirm = async () => {
    if (!item || !open || reject.isPending) return;
    const raw = String(new FormData(formRef.current ?? undefined).get('reason') ?? '');
    const reason = stripControlCharacters(raw).trim();
    if (reason.length === 0) return fail(t('calls:approval.reasonRequired'));
    if (reason.length > APPROVAL_SAFE_REASON_MAX_LENGTH) return fail(t('calls:approval.reasonTooLong'));
    setErrors([]);
    try {
      const decided = await reject.mutateAsync({ approvalId: item.id, safeReason: reason });
      onRejected(decided);
      close();
    } catch (err) {
      fail(mapApprovalError(err, t as CallsT));
    }
  };

  const handleConfirm = () => {
    confirming.current = true;
    queueMicrotask(() => {
      confirming.current = false;
    });
    void confirm();
  };

  const handleOpenChange = (next: boolean) => {
    if (next || confirming.current || reject.isPending) return;
    close();
  };

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent
        title={t('calls:approval.rejectTitle')}
        description={item ? t('calls:approval.rejectDescription', { name: item.employeeDisplayName }) : undefined}
        confirmLabel={t('calls:approval.reject')}
        cancelLabel={t('calls:approval.cancel')}
        destructive
        onConfirm={handleConfirm}
        confirmPending={reject.isPending}
      >
        <form ref={formRef} noValidate onSubmit={(e) => e.preventDefault()} className="space-y-4">
          <FormErrorSummary title={t('common:form.errorSummaryTitle')} errors={errors} />
          <Field
            id={REASON_ID}
            label={t('calls:approval.reasonLabel')}
            description={t('calls:approval.reasonHint')}
            error={errors[0]?.message}
            required
          >
            <Textarea name="reason" rows={3} />
          </Field>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}

export interface ApprovalsScreenProps {
  api: CallsApi;
  sampleMode: boolean;
}

export function ApprovalsScreen({ api, sampleMode }: ApprovalsScreenProps) {
  const { t } = useTranslation(['calls', 'common']);
  const { principal } = useAuth();
  const { add: addToast } = useToast();
  const queryClient = useQueryClient();
  const orgId = principal?.context.kind === 'organization' ? principal.context.orgId : null;
  const enabled = !sampleMode && orgId !== null;
  const list = useQuery({ ...approvalListQuery(api, orgId ?? ''), enabled });
  const approve = useMutation(approveApprovalMutation(api));
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [decideError, setDecideError] = useState<string | null>(null);
  /** The last item opened for declining: kept after closing, for the dialog's exit animation. */
  const [rejecting, setRejecting] = useState<AppointmentApprovalItem | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);

  const refresh = () => {
    if (orgId) void queryClient.invalidateQueries({ queryKey: approvalKeys.list(orgId) });
  };

  const handleApprove = async (item: AppointmentApprovalItem) => {
    if (approve.isPending) return;
    setDecideError(null);
    setApprovingId(item.id);
    try {
      await approve.mutateAsync(item.id);
      addToast({ title: t('calls:approval.approvedToast', { name: item.employeeDisplayName }), tone: 'success' });
    } catch (err) {
      setDecideError(mapApprovalError(err, t as CallsT));
    } finally {
      setApprovingId(null);
      refresh();
    }
  };

  const handleRejected = (item: AppointmentApprovalItem) => {
    addToast({ title: t('calls:approval.rejectedToast', { name: item.employeeDisplayName }), tone: 'success' });
    refresh();
  };

  const items = list.data?.items ?? [];
  const pending = items.filter((item) => item.status === 'pending');
  const decided = items.filter((item) => item.status !== 'pending');

  return (
    <div className="space-y-8">
      <div className="space-y-2">
        <Heading level={1} typeRole="screenTitle">
          {t('calls:approval.title')}
        </Heading>
        <p className="type-body text-text-secondary">{t('calls:approval.intro')}</p>
      </div>

      {sampleMode ? (
        <>
          <Alert tone="info">{t('calls:approval.sampleNote')}</Alert>
          <StatusBlock state="empty" title={t('calls:approval.emptyTitle')} body={t('calls:approval.emptyBody')} />
        </>
      ) : orgId === null ? (
        <Alert tone="info">{t('calls:approval.noOrganization')}</Alert>
      ) : list.isPending ? (
        <StatusBlock state="loading" title={t('common:state.loading')} body="" />
      ) : list.isError ? (
        <Alert tone="danger" title={t('calls:approval.loadFailedTitle')}>
          <p>{mapApprovalError(list.error, t as CallsT)}</p>
          <Button variant="secondary" className="mt-3" onClick={() => void list.refetch()}>
            {t('calls:approval.retry')}
          </Button>
        </Alert>
      ) : (
        <>
          {decideError ? (
            <Alert tone="danger" title={t('calls:approval.decideFailedTitle')}>
              {decideError}
            </Alert>
          ) : null}
          {items.length === 0 ? (
            <StatusBlock state="empty" title={t('calls:approval.emptyTitle')} body={t('calls:approval.emptyBody')} />
          ) : null}
          {pending.length > 0 ? (
            <section aria-labelledby="approvals-pending" className="space-y-3">
              <Heading level={2} typeRole="sectionTitle" id="approvals-pending">
                {t('calls:approval.pendingTitle')}
              </Heading>
              <ul className="space-y-3">
                {pending.map((item) => (
                  <ApprovalCard
                    key={item.id}
                    item={item}
                    onApprove={(i) => void handleApprove(i)}
                    onReject={(i) => {
                      setDecideError(null);
                      setRejecting(i);
                      setRejectOpen(true);
                    }}
                    approving={approvingId === item.id}
                    disabled={approve.isPending}
                  />
                ))}
              </ul>
            </section>
          ) : null}
          {decided.length > 0 ? (
            <section aria-labelledby="approvals-decided" className="space-y-3">
              <Heading level={2} typeRole="sectionTitle" id="approvals-decided">
                {t('calls:approval.decidedTitle')}
              </Heading>
              <ul className="space-y-3">
                {decided.map((item) => (
                  <ApprovalCard key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}

      <RejectApprovalDialog
        item={rejecting}
        open={rejectOpen}
        api={api}
        onClose={() => setRejectOpen(false)}
        onRejected={handleRejected}
      />
    </div>
  );
}
