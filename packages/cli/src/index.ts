export { CLI_VERSION } from './version.js';
export { main } from './cli-main.js';

import { runAsMain } from './cli-entry-point.js';
import { main } from './cli-main.js';
runAsMain(main);
