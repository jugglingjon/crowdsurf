// Entry for the script-tag build: puts `crowdsurf` on the page as a global.
//
//   <script src="crowdsurf.global.min.js"></script>
//   <script>crowdsurf('#features', { mistakes: 0.2 });</script>
//
// The helpers that are separate exports in the module build hang off the function:
// crowdsurf.forget(), crowdsurf.activeAgents(), crowdsurf.defaults, crowdsurf.slipKinds.

import crowdsurf, { forget, activeAgents, DEFAULTS, SLIP_KINDS } from './index.js';

crowdsurf.forget = forget;
crowdsurf.activeAgents = activeAgents;
crowdsurf.defaults = DEFAULTS;
crowdsurf.slipKinds = SLIP_KINDS;

globalThis.crowdsurf = crowdsurf;
