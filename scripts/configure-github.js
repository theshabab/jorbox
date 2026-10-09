import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Read only the requested GitHub credentials. Never print values or evaluate file content.
const source = readFileSync('.dev.vars', 'utf8');
const secrets = {};
for (const name of ['GITHUB_CLIENT_ID', 'GITHUB_CLIENT_SECRET']) {
  const line = source.split(/\r?\n/).find(line => line.trim().startsWith(`${name}=`));
  let value = line?.trim().slice(name.length + 1).trim();
  if (value?.startsWith('"') && value.endsWith('"')) value = JSON.parse(value);
  else if (value?.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
  if (!value) throw new Error(`Fill ${name} in .dev.vars first.`);
  secrets[name] = value;
}
const result = spawnSync('npx', ['wrangler', 'secret', 'bulk'], { input: JSON.stringify(secrets), encoding: 'utf8', stdio: ['pipe', 'inherit', 'inherit'] });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
