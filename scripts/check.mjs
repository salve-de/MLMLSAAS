import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
let count = 0;
for (const folder of ['src', 'public', 'scripts', 'test']) for (const name of readdirSync(folder)) {
  if (!/\.(mjs|js)$/.test(name)) continue;
  const result = spawnSync(process.execPath, ['--check', join(folder, name)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
  count++;
}
console.log(`Syntax checked ${count} JavaScript modules.`);
