import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const agentDir = join(root, 'agent');

console.log('Installing agent dependencies...');
execSync('npm install', { cwd: agentDir, stdio: 'inherit' });
console.log('Running agent tests...');
execSync('npm test', { cwd: agentDir, stdio: 'inherit' });
console.log('Agent build OK');
