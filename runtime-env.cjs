/* eslint-disable @typescript-eslint/no-require-imports -- Loaded synchronously by the generated CommonJS server. */
const fs = require('node:fs');
const path = require('node:path');

process.env.NODE_ENV = 'production';

// A full checkout keeps env files at the project root. A standalone-only
// deployment keeps them beside server.js. Do not depend on the panel's cwd.
const projectRoot = path.resolve(__dirname, '..', '..');
const isNestedBundle = path.basename(__dirname) === 'standalone'
  && path.basename(path.dirname(__dirname)) === '.next'
  && fs.existsSync(path.join(projectRoot, 'runtime-env.cjs'));
const envDirectory = isNestedBundle ? projectRoot : __dirname;
require('@next/env').loadEnvConfig(envDirectory, false);

const port = process.env.PORT ?? '3000';
if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}
process.env.PORT = port;
console.log(`[startup] HTTP port: ${port} (environment directory: ${envDirectory})`);
