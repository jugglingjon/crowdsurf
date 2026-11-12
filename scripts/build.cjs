// Builds dist/ from src/:
//
//   crowdsurf.js              ES module, for bundlers and <script type="module">
//   crowdsurf.auto.js         ES module that builds every [data-crowdsurf] element
//   crowdsurf.global.min.js   plain <script>: defines window.crowdsurf
//   crowdsurf.auto.min.js     plain <script>: defines window.crowdsurf and runs it
//   prehide.css, index.d.ts   copied as they are

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const esbuild = require('esbuild');

const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const pkg = require(path.join(root, 'package.json'));
const banner = { js: `/*! Crowdsurf ${pkg.version} | ${pkg.homepage} */` };

const shared = { bundle: true, target: 'es2022', logLevel: 'warning', banner, absWorkingDir: root };

const builds = [
  { entryPoints: ['src/index.js'], outfile: 'dist/crowdsurf.js', format: 'esm' },
  { entryPoints: ['src/auto.js'], outfile: 'dist/crowdsurf.auto.js', format: 'esm' },
  { entryPoints: ['src/global.js'], outfile: 'dist/crowdsurf.global.min.js', format: 'iife', minify: true },
  { entryPoints: ['src/global-auto.js'], outfile: 'dist/crowdsurf.auto.min.js', format: 'iife', minify: true },
];

(async () => {
  fs.rmSync(dist, { recursive: true, force: true });
  fs.mkdirSync(dist, { recursive: true });
  for (const build of builds) await esbuild.build({ ...shared, ...build });
  fs.copyFileSync(path.join(root, 'src/prehide.css'), path.join(dist, 'prehide.css'));
  fs.copyFileSync(path.join(root, 'src/index.d.ts'), path.join(dist, 'index.d.ts'));

  for (const file of fs.readdirSync(dist).sort()) {
    const buf = fs.readFileSync(path.join(dist, file));
    const kb = (n) => (n / 1024).toFixed(1).padStart(6) + ' kB';
    console.log(`${file.padEnd(28)}${kb(buf.length)}  ${kb(zlib.gzipSync(buf).length)} gzipped`);
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
