// The admin app's Vite config on the journeys' port and API (see vite-app.mjs).
import appConfig from '../../apps/admin/vite.config';
import { ADMIN_PORT } from './servers.mjs';
import { forJourneys } from './vite-app.mjs';

export default forJourneys(appConfig, ADMIN_PORT);
