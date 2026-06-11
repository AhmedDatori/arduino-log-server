'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const backendDir = path.join(root, 'backend');

function collectJavaScriptFiles(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap(entry => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(fullPath);
    return entry.isFile() && entry.name.endsWith('.js') ? [fullPath] : [];
  });
}

let failed = false;

for (const file of collectJavaScriptFiles(backendDir)) {
  const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' });
  if (result.status !== 0) failed = true;
}

process.env.PGHOST = process.env.PGHOST || 'localhost';
process.env.PGUSER = process.env.PGUSER || 'postgres';
process.env.PGPASSWORD = process.env.PGPASSWORD || 'placeholder';

const appCheck = spawnSync(process.execPath, ['-e', `
  const { createApp } = require('./backend/app');
  const result = createApp();
  if (!result.app || !result.jobs) throw new Error('createApp failed');
`], {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});

if (appCheck.status !== 0) failed = true;

if (failed) process.exit(1);
console.log('Backend checks passed');
