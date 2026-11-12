// Drop-in entry: builds every [data-crowdsurf] element on the page.
//
//   <script type="module" src="crowdsurf/src/auto.js"></script>
//   <section data-crowdsurf> ... </section>

import { crowdsurf } from './index.js';

export const instance = crowdsurf('[data-crowdsurf]');
export default instance;
