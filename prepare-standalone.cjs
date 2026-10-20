/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS build tooling. */
const fs = require('node:fs');
const path = require('node:path');

function prepareStandalone(projectRoot) {
  const bundle = path.join(projectRoot, '.next', 'standalone');
  const serverPath = path.join(bundle, 'server.js');
  const bootstrap = "require('./runtime-env.cjs');\n";
  const server = fs.readFileSync(serverPath, 'utf8');

  fs.cpSync(path.join(projectRoot, '.next', 'static'), path.join(bundle, '.next', 'static'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'public'), path.join(bundle, 'public'), { recursive: true });
  for (const file of ['start.cjs', 'runtime-env.cjs']) {
    fs.copyFileSync(path.join(projectRoot, file), path.join(bundle, file));
  }
  // aaPanel and process managers may launch server.js directly. Load env before
  // the generated code reads PORT, not later during Next's initialization.
  if (!server.startsWith(bootstrap)) fs.writeFileSync(serverPath, bootstrap + server);
}

if (require.main === module) prepareStandalone(__dirname);
module.exports = { prepareStandalone };
