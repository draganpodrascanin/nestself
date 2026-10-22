import type {
  PreSignUpTriggerEvent,
  PreSignUpTriggerHandler,
} from 'aws-lambda';

/**
 * Cognito PreSignUp Lambda trigger.
 *
 * External-provider branch (PreSignUp_ExternalProvider):
 *   Auto-confirms the user. Carries email_verified from the IdP assertion
 *   so Cognito does not reset it to false on federated sign-in [D-04].
 *   Does no database work; identity linking happens in the API callback.
 *
 * Admin branch (PreSignUp_AdminCreateUser):
 *   Allowed. AdminCreateUser is the provisioning path [D-03].
 *
 * Native branch (PreSignUp_SignUp):
 *   Self sign-up is disabled at the pool level. If this branch fires
 *   (e.g. via a direct SDK call), reject it [D-03].
 */
export const handler: PreSignUpTriggerHandler = async (
  event: PreSignUpTriggerEvent,
) => {
  const { triggerSource } = event;

  if (triggerSource === 'PreSignUp_ExternalProvider') {
    event.response.autoConfirmUser = true;
    const idpEmailVerified =
      event.request.userAttributes['email_verified'] === 'true';
    event.response.autoVerifyEmail = idpEmailVerified;
    return event;
  }

  if (triggerSource === 'PreSignUp_AdminCreateUser') {
    return event;
  }

  // Native self sign-up: reject
  throw new Error(
    'Self sign-up is not allowed. Please contact your HR administrator.',
  );
};
