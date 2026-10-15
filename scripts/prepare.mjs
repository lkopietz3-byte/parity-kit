// The `prepare` lifecycle step: it runs when this folder is installed from a
// checkout (`npm install ./parity-kit`) and builds dist/.
//
// A fresh clone has no node_modules and no dist/ (dist/ is not committed), so
// the compiler is missing and a bare `tsc` call dies with "tsc: command not
// found" (exit 127) and leaves the consumer with a link to a folder that has no
// build. This script builds when the compiler is installed and otherwise stops
// with the exact commands to run.

import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

try {
  require.resolve('typescript/bin/tsc');
} catch {
  console.error(
    [
      'parity-kit: cannot build dist/ because its dev dependencies are not installed here.',
      `Run this once inside ${root} and then install again:`,
      '  npm ci && npm run build',
    ].join('\n'),
  );
  process.exit(1);
}

execFileSync('npm', ['run', 'build'], {
  cwd: root,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
