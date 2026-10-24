/**
 * Non-disclosure on appointment routes (CALL-17, D-CW-30, CW-R-29): every
 * authorization denial answers 404 `not_found`, never 403 `forbidden`.
 *
 * The guard and `AuthorizationService.require()` answer 403 when the caller
 * has visibility into the organization (an active membership or a staff
 * template). On these routes that would tell an employer administrator that
 * an appointment exists in their organization, so the controller maps the
 * denial to the not-found envelope here. The denial is still audited as
 * `access.denied` before it reaches this filter. Context errors
 * (`context_mismatch`), step-up (`step_up_required`) and domain errors keep
 * their status.
 */
import { type ArgumentsHost, Catch, type ExceptionFilter } from '@nestjs/common';
import { ApiHttpException } from '../common/api-error.js';
import { ApiExceptionFilter } from '../common/api-exception.filter.js';

@Catch(ApiHttpException)
export class AppointmentNonDisclosureFilter implements ExceptionFilter {
  private readonly envelope = new ApiExceptionFilter();

  catch(exception: ApiHttpException, host: ArgumentsHost): void {
    const denied = exception.getStatus() === 403 && exception.code === 'forbidden';
    this.envelope.catch(
      denied ? new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' }) : exception,
      host,
    );
  }
}
