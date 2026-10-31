/**
 * Non-disclosure on appointment routes (CALL-17, D-CW-30, CW-R-29): every
 * authorization denial answers 404 `not_found`, never 403 `forbidden`.
 *
 * The guard and `AuthorizationService.require()` answer 403 when the caller
 * has visibility into the organization (an active membership or a staff
 * template). On these routes that would tell an employer administrator that
 * an appointment exists in their organization, so the controller maps the
 * denial to the not-found envelope here. The denial is still audited as
 * `access.denied` before it reaches this filter. A `context_mismatch` (the
 * create route answers it to anybody outside the operations context: the
 * expert, employer administrators) is mapped the same way. Session and
 * step-up errors (`session_required`, `step_up_required`) and domain errors
 * keep their status.
 *
 * A {@link ParticipantForbiddenException} also keeps its 403: a service raises
 * it to a participant of the appointment for a step reserved to the other
 * participant (the employee ending the call, the expert giving feedback), so
 * nothing is disclosed that the caller does not already know.
 */
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { ApiHttpException } from '../common/api-error.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';

const NON_DISCLOSED_CODES: ReadonlySet<string> = new Set(['forbidden', 'context_mismatch']);

/** 403 `forbidden` to a known participant, for a step only the other participant may take. */
export class ParticipantForbiddenException extends ApiHttpException {
  constructor(message: string) {
    super({ status: 403, code: 'forbidden', message });
  }
}

@Catch(ApiHttpException)
export class AppointmentNonDisclosureFilter implements ExceptionFilter {
  private readonly envelope = new ApiExceptionFilter();

  catch(exception: ApiHttpException, host: ArgumentsHost): void {
    const denied =
      !(exception instanceof ParticipantForbiddenException) &&
      exception.getStatus() === 403 &&
      NON_DISCLOSED_CODES.has(exception.code);
    this.envelope.catch(
      denied ? new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' }) : exception,
      host,
    );
  }
}
