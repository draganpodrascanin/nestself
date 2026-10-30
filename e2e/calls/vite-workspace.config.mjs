// The workspace app's Vite config on the journeys' port and API (see vite-app.mjs).
import appConfig from '../../apps/workspace/vite.config';
import { WORKSPACE_PORT } from './servers.mjs';
import { forJourneys } from './vite-app.mjs';

export default forJourneys(appConfig, WORKSPACE_PORT);
