/**
 * Sample-mode adapters: the fixtures of `@nestself/sample-data`, flagged and
 * read only. Mutations are disabled on every listening screen in sample mode.
 */
import {
  SAMPLE_DIMENSION_DETAILS,
  SAMPLE_LISTENING_CONFIGURATION,
  SAMPLE_LISTENING_HEATMAP,
  SAMPLE_LISTENING_OVERVIEW,
  SAMPLE_MY_SURVEY,
  SAMPLE_ORG,
  SAMPLE_SURVEY_CYCLES,
} from '@nestself/sample-data';
import type { ListeningDimensionKey } from '@nestself/contracts';

export const sampleMySurvey = () => SAMPLE_MY_SURVEY;
export const sampleOverview = () => SAMPLE_LISTENING_OVERVIEW;
export const sampleHeatmap = () => SAMPLE_LISTENING_HEATMAP;
export const sampleDimension = (key: ListeningDimensionKey) => SAMPLE_DIMENSION_DETAILS[key];
export const sampleCycles = () => SAMPLE_SURVEY_CYCLES;
export const sampleConfiguration = () => SAMPLE_LISTENING_CONFIGURATION;
export const sampleOrganizationName = () => SAMPLE_ORG.name;
