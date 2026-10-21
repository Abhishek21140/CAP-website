import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const searchRoot = path.resolve(projectRoot, process.argv[2] ?? 'tests');

if (!searchRoot.startsWith(`${projectRoot}${path.sep}`)) {
  throw new Error('Test search path must be inside the project.');
}

async function collectTestFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectTestFiles(entryPath);
    return entry.isFile() && entry.name.endsWith('.test.ts') ? [entryPath] : [];
  }));
  return files.flat();
}

const testFiles = (await collectTestFiles(searchRoot)).sort();

if (testFiles.length === 0) {
  throw new Error(`No .test.ts files found under ${path.relative(projectRoot, searchRoot)}.`);
}

const result = spawnSync(
  process.execPath,
  ['--import', 'tsx', '--test', ...testFiles],
  { cwd: projectRoot, stdio: 'inherit' },
);

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
