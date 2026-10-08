import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export const root = dirname(dirname(__dirname));
export const buildDir = join(root, 'build');
export const distDir = join(root, 'dist');
export const version = '1.0.0';

export const paths = {
  agent: join(buildDir, 'agent'),
  gui: join(buildDir, 'gui'),
  updater: join(buildDir, 'updater'),
  installer: join(buildDir, 'installer'),
  metadata: join(buildDir, 'metadata'),
};
