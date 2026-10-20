/* eslint-disable @typescript-eslint/no-require-imports -- Tests for CommonJS startup tooling. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { prepareStandalone } = require('../prepare-standalone.cjs');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'kirimku-startup-'));
  t.after(() => {
    assert.equal(path.dirname(root), os.tmpdir());
    fs.rmSync(root, { recursive: true, force: true });
  });
  const bundle = path.join(root, '.next', 'standalone');
  fs.mkdirSync(bundle, { recursive: true });
  fs.mkdirSync(path.join(root, '.next', 'static'));
  fs.mkdirSync(path.join(root, 'public'));
  for (const file of ['start.cjs', 'runtime-env.cjs']) {
    fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
  }
  // Match the generated server's early PORT read, before any Next startup.
  fs.writeFileSync(path.join(bundle, 'server.js'),
    'console.log("RESULT=" + (parseInt(process.env.PORT, 10) || 3000));');
  prepareStandalone(root);
  return { root, bundle };
}

function launch(entry, port) {
  const env = { ...process.env, NODE_PATH: path.resolve(path.dirname(require.resolve('@next/env/package.json')), '..', '..') };
  delete env.PORT;
  delete env.__NEXT_PROCESSED_ENV;
  if (port !== undefined) env.PORT = port;
  return spawnSync(process.execPath, [entry], { env, cwd: os.tmpdir(), encoding: 'utf8' });
}

test('root launcher and direct generated server read project .env from another cwd', (t) => {
  const { root, bundle } = fixture(t);
  fs.writeFileSync(path.join(root, '.env'), 'PORT=3001\n');
  for (const entry of [path.join(root, 'start.cjs'), path.join(bundle, 'server.js'), path.join(bundle, 'start.cjs')]) {
    const result = launch(entry);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /RESULT=3001/);
  }
});

test('standalone-only deployment reads env beside server.js', (t) => {
  const { root, bundle } = fixture(t);
  fs.unlinkSync(path.join(root, 'runtime-env.cjs'));
  fs.writeFileSync(path.join(bundle, '.env'), 'PORT=3001\n');
  const result = launch(path.join(bundle, 'server.js'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT=3001/);
});

test('process environment overrides files and invalid ports fail clearly', (t) => {
  const { root, bundle } = fixture(t);
  fs.writeFileSync(path.join(root, '.env'), 'PORT=3001\n');
  const entry = path.join(bundle, 'server.js');
  const override = launch(entry, '4321');
  assert.equal(override.status, 0, override.stderr);
  assert.match(override.stdout, /RESULT=4321/);
  for (const port of ['invalid', '0', '65536']) {
    const result = launch(entry, port);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /PORT must be an integer between 1 and 65535/);
  }
});

test('production env files take precedence and preparation is idempotent', (t) => {
  const { root, bundle } = fixture(t);
  fs.writeFileSync(path.join(root, '.env'), 'PORT=3000\n');
  fs.writeFileSync(path.join(root, '.env.production'), 'PORT=3001\n');
  prepareStandalone(root);
  const result = launch(path.join(bundle, 'server.js'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT=3001/);
  const server = fs.readFileSync(path.join(bundle, 'server.js'), 'utf8');
  assert.equal(server.split("require('./runtime-env.cjs');").length, 2);
});

test('default port stays 3000 when no port is configured', (t) => {
  const { bundle } = fixture(t);
  const result = launch(path.join(bundle, 'server.js'));
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /RESULT=3000/);
});
