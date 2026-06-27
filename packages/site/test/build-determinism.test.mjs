// Build-determinism test: two consecutive builds from the same source must
// produce byte-identical integrity.json. Catches non-determinism sources such
// as timestamps, random UUIDs, or non-sorted map iteration.
//
// Run: node packages/site/test/build-determinism.test.mjs

import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../..');

function build() {
  execSync('node scripts/build.js', { cwd: ROOT, stdio: 'pipe' });
  return readFileSync(join(ROOT, 'dist/integrity.json'), 'utf8');
}

const first  = build();
const second = build();

if (first === second) {
  console.log('ok: integrity.json is identical across two consecutive builds');
} else {
  // Emit a diff-friendly view of the first differing line
  const a = first.split('\n');
  const b = second.split('\n');
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      console.error('FAIL: first difference at line ' + (i + 1));
      console.error('  build 1: ' + a[i]);
      console.error('  build 2: ' + b[i]);
      break;
    }
  }
  process.exit(1);
}
