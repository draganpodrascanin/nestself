/**
 * Sample-mode data for the operations listening screens, from the shared
 * fixtures. Nothing here was published to or configured for a real client.
 */
import { SAMPLE_LISTENING_CONFIGURATION, SAMPLE_QUESTIONNAIRES } from '@nestself/sample-data';
import type { ListeningConfigurationResponse, QuestionnaireVersionResponse } from '@nestself/contracts';

export function sampleQuestionnaires(): QuestionnaireVersionResponse[] {
  return [...SAMPLE_QUESTIONNAIRES.items];
}

export function sampleClientConfiguration(orgId: string): ListeningConfigurationResponse {
  return { ...SAMPLE_LISTENING_CONFIGURATION, orgId };
}
