import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_ROOT,
  QAVS_REFERENCE_COMMIT,
  QAVS_SPEC_COMMIT,
  readJson,
  validateProvenance,
} from './releaseMetadata.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DIST_DIR = resolve(SCRIPT_DIR, '..', 'dist');
const RELEASE_DIR = resolve(SCRIPT_DIR, '..', '.release');
const allowDirty = process.argv.includes('--allow-dirty');

const run = (command, args, options = {}) => {
  const { capture: shouldCapture = false, ...execOptions } = options;
  return (
    execFileSync(command, args, {
      cwd: PROJECT_ROOT,
      encoding: 'utf8',
      stdio: shouldCapture ? 'pipe' : 'inherit',
      ...execOptions,
    }) ?? ''
  );
};

const capture = (command, args) => run(command, args, { capture: true }).trim();

const listFiles = (root, current = root) => {
  const output = [];
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) {
      output.push(...listFiles(root, absolute));
    } else if (entry.isFile()) {
      output.push(relative(root, absolute).split(sep).join('/'));
    } else {
      throw new Error(
        `Release tree contains unsupported filesystem entry: ${absolute}`
      );
    }
  }
  return output.sort();
};

const assertSafeReleaseTree = (files) => {
  const required = [
    'index.html',
    'qortium-app.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
  ];
  for (const path of required) {
    if (!files.includes(path)) {
      throw new Error(`Release build is missing required root file: ${path}`);
    }
  }

  const unsafe = files.filter((path) => {
    const normalized = path.toLowerCase();
    return (
      normalized.startsWith('node_modules/') ||
      normalized.includes('/node_modules/') ||
      normalized.endsWith('.map') ||
      normalized.endsWith('.zip') ||
      normalized.endsWith('.tar') ||
      normalized.endsWith('.tgz') ||
      normalized === '.env' ||
      normalized.startsWith('.env.') ||
      normalized.includes('private-key') ||
      normalized.includes('wallet')
    );
  });
  if (unsafe.length) {
    throw new Error(`Unsafe release files found:\n- ${unsafe.join('\n- ')}`);
  }

  for (const path of files) {
    const absolute = join(DIST_DIR, path);
    const content = readFileSync(absolute);
    if (
      content.includes('/home/iffi/') ||
      content.includes('-----BEGIN PRIVATE KEY-----') ||
      content.includes('-----BEGIN QORTIUM')
    ) {
      throw new Error(
        `Release file contains local-path or secret-like material: ${path}`
      );
    }
  }
};

const normalizeTimes = (root, timestamp) => {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const absolute = join(root, entry.name);
    if (entry.isDirectory()) {
      normalizeTimes(absolute, timestamp);
    }
    utimesSync(absolute, timestamp, timestamp);
  }
  utimesSync(root, timestamp, timestamp);
};

const status = capture('git', [
  'status',
  '--porcelain',
  '--untracked-files=all',
]);
const dirty = Boolean(status);
if (dirty && !allowDirty) {
  throw new Error(
    'Release artifacts require a clean working tree. Use --allow-dirty only for an explicitly non-publishing dry run.'
  );
}

const packageJson = await readJson('package.json');
const manifest = await readJson('qortium-app.json');
const commit = capture('git', ['rev-parse', 'HEAD']);
const branch = capture('git', ['branch', '--show-current']) || 'DETACHED';
const commitTimestamp = Number.parseInt(
  capture('git', ['show', '-s', '--format=%ct', 'HEAD']),
  10
);
const sourceDate = new Date(commitTimestamp * 1000);
const npmVersion = capture('npm', ['--version']);

rmSync(RELEASE_DIR, { recursive: true, force: true });
rmSync(DIST_DIR, { recursive: true, force: true });
mkdirSync(RELEASE_DIR, { recursive: true });

run('npm', ['run', 'build']);

const files = listFiles(DIST_DIR);
assertSafeReleaseTree(files);
normalizeTimes(DIST_DIR, sourceDate);

const artifactFilename = `qortium-discussion-boards-${packageJson.version}.zip`;
const artifactPath = join(RELEASE_DIR, artifactFilename);
execFileSync('zip', ['-X', '-q', artifactPath, ...files], {
  cwd: DIST_DIR,
  stdio: 'inherit',
});

const artifact = readFileSync(artifactPath);
const artifactSha256 = createHash('sha256').update(artifact).digest('hex');
const artifactByteSize = statSync(artifactPath).size;
writeFileSync(
  `${artifactPath}.sha256`,
  `${artifactSha256}  ${artifactFilename}\n`,
  'utf8'
);

const provenance = {
  schema: 'qortium.discussion-boards.release-provenance/v1',
  appName: manifest.name,
  version: packageJson.version,
  source: {
    commit,
    branch,
    dirty,
  },
  build: {
    timestamp: new Date().toISOString(),
    sourceDateEpoch: commitTimestamp,
    nodeVersion: process.version,
    npmVersion,
  },
  qavs: {
    status: 'draft-v1',
    specificationCommit: QAVS_SPEC_COMMIT,
    referenceCommit: QAVS_REFERENCE_COMMIT,
    manifestVersion: manifest.version,
  },
  artifact: {
    filename: artifactFilename,
    sha256: artifactSha256,
    byteSize: artifactByteSize,
  },
  expectedReleaseTag: `v${packageJson.version}`,
  qdn: {
    service: 'APP',
    publisher: 'Discussion_Boards',
    identifier: 'discussion-boards',
    resourceReference: null,
  },
};

const provenanceResult = validateProvenance(provenance);
if (!provenanceResult.valid) {
  throw new Error(
    `Generated provenance is invalid:\n- ${provenanceResult.errors.join('\n- ')}`
  );
}
writeFileSync(
  join(RELEASE_DIR, 'provenance.json'),
  `${JSON.stringify(provenance, null, 2)}\n`,
  'utf8'
);

console.log(`Release artifact: ${artifactPath}`);
console.log(`Artifact bytes: ${artifactByteSize}`);
console.log(`SHA-256: ${artifactSha256}`);
console.log(`Provenance: ${join(RELEASE_DIR, 'provenance.json')}`);
if (dirty) {
  console.log(
    'Dry-run provenance records dirty=true; this artifact must not be published.'
  );
}
