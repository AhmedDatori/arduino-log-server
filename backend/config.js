'use strict';

const fs = require('fs');
const path = require('path');

function loadLocalEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnvFile();

const port = Number(process.env.PORT || 3000);
const clientDistDir = path.join(__dirname, '..', 'dist');
const geminiModel = process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(name + ' environment variable is required');
  return value;
}

function databaseConfig() {
  if (process.env.DATABASE_URL) {
    return {
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' },
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
      connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
    };
  }

  return {
    host: required('PGHOST'),
    port: Number(process.env.PGPORT || 5432),
    database: process.env.PGDATABASE || 'postgres',
    user: required('PGUSER'),
    password: required('PGPASSWORD'),
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true' },
    max: Number(process.env.DB_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.DB_IDLE_TIMEOUT_MS || 30000),
    connectionTimeoutMillis: Number(process.env.DB_CONNECTION_TIMEOUT_MS || 5000),
  };
}

module.exports = { port, clientDistDir, geminiModel, databaseConfig };
