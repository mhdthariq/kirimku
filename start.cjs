/* eslint-disable @typescript-eslint/no-require-imports -- CommonJS standalone startup. */
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'production';
if (process.argv.includes('--preview')) process.env.PREVIEW_MODE = 'true';

require('./runtime-env.cjs');

const bundledServer = path.join(__dirname, 'server.js');
require(fs.existsSync(bundledServer)
  ? bundledServer
  : path.join(__dirname, '.next', 'standalone', 'server.js'));
