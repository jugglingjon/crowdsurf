// Drop-in entry: builds every [data-swarm] element on the page.
//
//   <script type="module" src="swarm-web/src/auto.js"></script>
//   <section data-swarm> ... </section>

import { swarm } from './index.js';

export const instance = swarm('[data-swarm]');
export default instance;
