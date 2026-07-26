import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));

export const PROJECT_ROOT = resolve(SCRIPT_DIR, '..');
export const QAVS_SPEC_COMMIT = '7e0bd53b972a01bdcd02b6e4cefae76e13e54169';
export const QAVS_REFERENCE_COMMIT = 'a41e5f9678d7f20d7fb77a223c45fddc0096632e';
export const QAVS_MINIMUM_PLATFORM = '1.5';
export const QAVS_MANIFEST_MAX_BYTES = 16 * 1024;
export const GPL3_CANONICAL_SHA256 =
  '3972dc9744f6499f0f9b2dbf76696f2ae7ad8af9b23dde66d6af86c9dfb36986';
export const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/;

export const readJson = async (path) =>
  JSON.parse(await readFile(resolve(PROJECT_ROOT, path), 'utf8'));

export const sha256 = (value) =>
  createHash('sha256').update(value).digest('hex');

export const validateQavsManifest = (value) => {
  const errors = [];

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { valid: false, errors: ['manifest must be a JSON object'] };
  }

  if (typeof value.version !== 'string') {
    errors.push('version is required and must be a string');
  } else {
    const version = value.version.trim();
    if (!version || version.length > 32 || !VERSION_PATTERN.test(version)) {
      errors.push(
        'version must match QAVS X.Y.Z syntax and be at most 32 characters'
      );
    }
  }

  if (
    value.name !== undefined &&
    (typeof value.name !== 'string' || value.name.trim().length === 0)
  ) {
    errors.push('name, when present, must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
};

export const getPlatformLevel = (version) => {
  const match = VERSION_PATTERN.exec(version.trim());
  return match
    ? `${Number.parseInt(match[1], 10)}.${Number.parseInt(match[2], 10)}`
    : null;
};

export const validateProvenance = (value) => {
  const errors = [];
  const isObject = (candidate) =>
    Boolean(candidate) &&
    typeof candidate === 'object' &&
    !Array.isArray(candidate);
  const requireString = (record, key, label) => {
    if (
      !isObject(record) ||
      typeof record[key] !== 'string' ||
      !record[key].trim()
    ) {
      errors.push(`${label}.${key} must be a non-empty string`);
    }
  };

  if (!isObject(value)) {
    return { valid: false, errors: ['provenance must be a JSON object'] };
  }

  if (value.schema !== 'qortium.discussion-boards.release-provenance/v1') {
    errors.push('schema must identify release-provenance/v1');
  }
  requireString(value, 'appName', 'provenance');
  requireString(value, 'version', 'provenance');
  requireString(value, 'expectedReleaseTag', 'provenance');

  requireString(value.source, 'commit', 'source');
  requireString(value.source, 'branch', 'source');
  if (!isObject(value.source) || typeof value.source.dirty !== 'boolean') {
    errors.push('source.dirty must be boolean');
  }

  requireString(value.build, 'timestamp', 'build');
  requireString(value.build, 'nodeVersion', 'build');
  requireString(value.build, 'npmVersion', 'build');

  requireString(value.qavs, 'status', 'qavs');
  requireString(value.qavs, 'specificationCommit', 'qavs');
  requireString(value.qavs, 'referenceCommit', 'qavs');
  requireString(value.qavs, 'manifestVersion', 'qavs');

  requireString(value.artifact, 'filename', 'artifact');
  requireString(value.artifact, 'sha256', 'artifact');
  if (
    !isObject(value.artifact) ||
    !Number.isSafeInteger(value.artifact.byteSize) ||
    value.artifact.byteSize <= 0
  ) {
    errors.push('artifact.byteSize must be a positive safe integer');
  }

  requireString(value.qdn, 'service', 'qdn');
  requireString(value.qdn, 'publisher', 'qdn');
  requireString(value.qdn, 'identifier', 'qdn');
  if (
    !isObject(value.qdn) ||
    (value.qdn.resourceReference !== null &&
      typeof value.qdn.resourceReference !== 'string')
  ) {
    errors.push('qdn.resourceReference must be null or a string');
  }

  return { valid: errors.length === 0, errors };
};

export const verifyVersionMetadata = async () => {
  const [
    packageJson,
    packageLock,
    manifest,
    manifestBytes,
    readme,
    license,
    viteConfig,
    footer,
  ] = await Promise.all([
    readJson('package.json'),
    readJson('package-lock.json'),
    readJson('qortium-app.json'),
    readFile(resolve(PROJECT_ROOT, 'qortium-app.json')),
    readFile(resolve(PROJECT_ROOT, 'README.md'), 'utf8'),
    readFile(resolve(PROJECT_ROOT, 'LICENSE')),
    readFile(resolve(PROJECT_ROOT, 'vite.config.ts'), 'utf8'),
    readFile(resolve(PROJECT_ROOT, 'src/components/layout/Footer.tsx'), 'utf8'),
  ]);

  const errors = [];
  const manifestResult = validateQavsManifest(manifest);
  errors.push(...manifestResult.errors);

  if (packageJson.version !== manifest.version) {
    errors.push('package.json and qortium-app.json versions differ');
  }
  if (packageLock.version !== packageJson.version) {
    errors.push('package-lock top-level version differs from package.json');
  }
  if (packageLock.packages?.['']?.version !== packageJson.version) {
    errors.push('package-lock root package version differs from package.json');
  }
  if (
    packageLock.name !== packageJson.name ||
    packageLock.packages?.['']?.name !== packageJson.name
  ) {
    errors.push('package-lock package name differs from package.json');
  }
  if (packageJson.license !== 'GPL-3.0-only') {
    errors.push('package.json license must be GPL-3.0-only');
  }
  if (packageLock.packages?.['']?.license !== packageJson.license) {
    errors.push('package-lock root package license differs from package.json');
  }
  if (manifestBytes.byteLength > QAVS_MANIFEST_MAX_BYTES) {
    errors.push('qortium-app.json exceeds the verified Home 16 KiB read limit');
  }
  if (getPlatformLevel(packageJson.version) !== QAVS_MINIMUM_PLATFORM) {
    errors.push(
      `version must declare verified minimum platform ${QAVS_MINIMUM_PLATFORM}`
    );
  }
  if (sha256(license) !== GPL3_CANONICAL_SHA256) {
    errors.push(
      'LICENSE does not match the canonical unmodified GNU GPLv3 text'
    );
  }
  if (!readme.includes('GPL-3.0-only')) {
    errors.push('README must identify GPL-3.0-only');
  }
  if (
    !viteConfig.includes('__APP_VERSION__') ||
    !footer.includes('__APP_VERSION__')
  ) {
    errors.push('build and UI must derive their version from package metadata');
  }

  return { valid: errors.length === 0, errors };
};

const isMain =
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
const command = isMain ? process.argv[2] : undefined;

if (command === 'validate-manifest') {
  const manifest = await readJson('qortium-app.json');
  const result = validateQavsManifest(manifest);
  if (!result.valid) {
    throw new Error(
      `QAVS manifest validation failed:\n- ${result.errors.join('\n- ')}`
    );
  }
  console.log(
    `QAVS manifest valid: ${manifest.name ?? '(unnamed)'} ${manifest.version} (platform ${getPlatformLevel(manifest.version)})`
  );
} else if (command === 'verify-version') {
  const result = await verifyVersionMetadata();
  if (!result.valid) {
    throw new Error(
      `Release metadata verification failed:\n- ${result.errors.join('\n- ')}`
    );
  }
  const packageJson = await readJson('package.json');
  console.log(`Version metadata synchronized at ${packageJson.version}`);
} else if (command) {
  throw new Error(`Unknown release metadata command: ${command}`);
}
