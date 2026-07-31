import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

import {
  GPL3_CANONICAL_SHA256,
  PROJECT_ROOT,
  QAVS_MINIMUM_PLATFORM,
  getPlatformLevel,
  readJson,
  validateProvenance,
  validateQavsManifest,
  verifyVersionMetadata,
} from './releaseMetadata.mjs';

const packageJson = await readJson('package.json');
const manifest = await readJson('qortium-app.json');
const packageLock = await readJson('package-lock.json');
const releaseSchema = await readJson('docs/release-provenance.schema.json');
const readText = (path) => readFileSync(join(PROJECT_ROOT, path), 'utf8');
const hashFile = (path) =>
  createHash('sha256').update(readFileSync(path)).digest('hex');

assert.deepEqual(Object.keys(manifest).sort(), ['name', 'version']);
assert.equal(validateQavsManifest(manifest).valid, true);
assert.equal(
  validateQavsManifest({
    name: 'Future manifest',
    version: '1.5.1',
    future: true,
  }).valid,
  true,
  'QAVS draft v1 ignores unknown fields'
);
assert.equal(validateQavsManifest({ name: 'Missing version' }).valid, false);
assert.equal(validateQavsManifest({ version: 'not-a-version' }).valid, false);
assert.equal(validateQavsManifest([]).valid, false);
assert.equal(getPlatformLevel(manifest.version), QAVS_MINIMUM_PLATFORM);

const versionResult = await verifyVersionMetadata();
assert.deepEqual(versionResult.errors, []);
assert.equal(packageJson.version, manifest.version);
assert.equal(packageLock.version, packageJson.version);
assert.equal(packageLock.packages[''].version, packageJson.version);
assert.equal(packageJson.license, 'GPL-3.0-only');
assert.equal(
  hashFile(join(PROJECT_ROOT, 'LICENSE')),
  GPL3_CANONICAL_SHA256,
  'LICENSE must be the unmodified official GPLv3 text'
);

const readme = readText('README.md');
const releasePolicy = readText('docs/RELEASE.md');
const releaseNotes = readText('docs/releases/ARCHITECTURE-V2-RC1.md');
const footer = readText('src/components/layout/Footer.tsx');
const releaseTool = readText('scripts/releaseArtifact.mjs');

assert.match(readme, /GPL-3\.0-only/);
assert.match(readme, /qortium-app\.json/);
assert.match(readme, /docs\/RELEASE\.md/);
assert.match(releasePolicy, /v1-legacy-state-model/);
assert.match(releasePolicy, /GitHub Release/);
assert.match(releasePolicy, /exact-release-tag/);
assert.match(
  releasePolicy,
  /qdn:\/\/APP\/Discussion_Boards\/discussion-boards/
);
assert.match(releasePolicy, /Architecture V2.*schemaVersion: 2/s);
assert.match(
  releaseNotes,
  /Automatic V1 adoption[\s\S]*activation remain\s+disabled/
);
assert.match(footer, /__APP_VERSION__/);
assert.match(footer, /Discussion Boards v\{__APP_VERSION__\} · Since 2026/);
assert.doesNotMatch(footer, /warranty|sourceUrl|github\.com|rel="license"/i);
assert.equal(releaseSchema.properties.qdn.properties.service.const, 'APP');
assert.equal(releaseSchema.additionalProperties, false);
assert.doesNotMatch(releaseTool, /PUBLISH_QDN_RESOURCE|git.+tag|gh.+release/i);

if (process.argv.includes('--artifact')) {
  const releaseDir = join(PROJECT_ROOT, '.release');
  const artifactName = `qortium-discussion-boards-${packageJson.version}.zip`;
  const artifactPath = join(releaseDir, artifactName);
  const checksumPath = `${artifactPath}.sha256`;
  const provenancePath = join(releaseDir, 'provenance.json');

  assert.equal(existsSync(artifactPath), true, 'release archive must exist');
  assert.equal(existsSync(checksumPath), true, 'release checksum must exist');
  assert.equal(
    existsSync(provenancePath),
    true,
    'release provenance must exist'
  );

  const entries = execFileSync('unzip', ['-Z1', artifactPath], {
    encoding: 'utf8',
  })
    .trim()
    .split('\n')
    .filter(Boolean);
  for (const required of [
    'index.html',
    'qortium-app.json',
    'LICENSE',
    'THIRD_PARTY_NOTICES.md',
  ]) {
    assert.equal(
      entries.includes(required),
      true,
      `${required} must be at ZIP root`
    );
  }
  assert.equal(
    entries.some((entry) => entry.startsWith('dist/')),
    false
  );
  assert.equal(
    entries.some((entry) => entry.includes('node_modules/')),
    false
  );
  assert.equal(
    entries.some((entry) => /\.map$|\.zip$|^\.env(?:\.|$)/i.test(entry)),
    false
  );

  const expectedChecksum = readText(`.release/${artifactName}.sha256`).split(
    /\s+/
  )[0];
  assert.equal(hashFile(artifactPath), expectedChecksum);

  const archivedManifest = JSON.parse(
    execFileSync('unzip', ['-p', artifactPath, 'qortium-app.json'], {
      encoding: 'utf8',
    })
  );
  assert.deepEqual(archivedManifest, manifest);

  const provenance = JSON.parse(readFileSync(provenancePath, 'utf8'));
  const provenanceResult = validateProvenance(provenance);
  assert.deepEqual(provenanceResult.errors, []);
  assert.equal(provenance.version, packageJson.version);
  assert.equal(provenance.artifact.filename, artifactName);
  assert.equal(provenance.artifact.sha256, expectedChecksum);
  assert.equal(provenance.qdn.resourceReference, null);
  assert.equal(typeof provenance.source.dirty, 'boolean');

  if (process.argv.includes('--assert-no-tag')) {
    const tags = execFileSync(
      'git',
      ['tag', '--list', `v${packageJson.version}`],
      { cwd: PROJECT_ROOT, encoding: 'utf8' }
    ).trim();
    assert.equal(tags, '', 'dry run must not create its expected release tag');
  }
}

console.log('Release metadata tests passed');
