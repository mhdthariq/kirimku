const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'production';
if (process.argv.includes('--preview')) process.env.PREVIEW_MODE = 'true';

// Load runtime configuration before Next's generated server reads PORT.
require('@next/env').loadEnvConfig(__dirname, false);

const port = process.env.PORT ?? '3000';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
process.env.PORT = port;

const bundledServer = path.join(__dirname, 'server.js');
require(fs.existsSync(bundledServer)
  ? bundledServer
  : path.join(__dirname, '.next', 'standalone', 'server.js'));
