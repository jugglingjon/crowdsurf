// Entry for the drop-in script-tag build: defines the `crowdsurf` global and builds
// every [data-crowdsurf] element, with no code to write.
//
//   <script src="crowdsurf.auto.min.js" defer></script>
//   <section data-crowdsurf> ... </section>
//
// The running instance is available as crowdsurf.instance.

import './global.js';

globalThis.crowdsurf.instance = globalThis.crowdsurf('[data-crowdsurf]');
