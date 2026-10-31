const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');

test('manifest, userscript, package and download versions agree', () => {
  const manifest = JSON.parse(read('manifest.json'));
  const pkg = JSON.parse(read('package.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.version, pkg.version);
  assert(read('content.js').includes(`// @version      ${manifest.version}`));
  assert(read('README.md').includes(`downloads/x-post-deleter-${manifest.version}.zip`));
  assert(fs.existsSync(path.join(root, 'downloads', `x-post-deleter-${manifest.version}.zip`)));
});

test('distribution requests no extra permissions and only injects on X', () => {
  const manifest = JSON.parse(read('manifest.json'));
  assert.equal(manifest.permissions, undefined);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.content_scripts.length, 1);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://x.com/*', 'https://www.x.com/*']);
  for (const file of manifest.content_scripts[0].js) assert(fs.existsSync(path.join(root, file)));
});
