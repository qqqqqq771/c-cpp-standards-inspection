// Downloads the prebuilt tree-sitter grammars (WebAssembly) used by the syntax engine into
// grammars/. The packages are fetched with `npm pack`, so their install scripts never run.
// Usage: node scripts/update-grammars.mjs [c-version] [cpp-version]
import { execFileSync, execSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'grammars');
const grammars = [
  { pkg: 'tree-sitter-c', version: process.argv[2] ?? '0.24.1' },
  { pkg: 'tree-sitter-cpp', version: process.argv[3] ?? '0.23.4' },
];

for (const { version } of grammars) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`Invalid version: ${version}`);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cppstd-grammars-'));
try {
  const licenses = [];
  for (const { pkg, version } of grammars) {
    const dir = path.join(tmp, pkg);
    fs.mkdirSync(dir);
    // Versions are validated above, so the command line contains no untrusted text.
    const tarball = execSync(`npm pack ${pkg}@${version} --silent`, { cwd: dir, encoding: 'utf8' }).trim().split('\n').pop();
    execFileSync('tar', ['-xzf', tarball, 'package/LICENSE', `package/${pkg}.wasm`], { cwd: dir });
    fs.copyFileSync(path.join(dir, 'package', `${pkg}.wasm`), path.join(out, `${pkg}.wasm`));
    licenses.push(`${pkg} ${version}\n\n${fs.readFileSync(path.join(dir, 'package', 'LICENSE'), 'utf8').trim()}\n`);
    console.log(`${pkg}@${version} -> grammars/${pkg}.wasm`);
  }
  fs.writeFileSync(path.join(out, 'LICENSE'), licenses.join('\n---\n\n'));
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
