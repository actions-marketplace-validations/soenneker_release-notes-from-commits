'use strict';

const { appendFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');

function escapeCommand(value) {
  return String(value).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
}

function input(name, env = process.env) {
  return (env[`INPUT_${name.toUpperCase().replaceAll(' ', '_')}`] || '').trim();
}

function mask(value) {
  if (value) process.stdout.write(`::add-mask::${escapeCommand(value)}\n`);
}

function output(name, value, env = process.env) {
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is unavailable. Run this action in a GitHub Actions step.');
  writeValue(env.GITHUB_OUTPUT, name, value);
}

function environment(name, value, env = process.env) {
  if (!env.GITHUB_ENV) throw new Error('GITHUB_ENV is unavailable.');
  writeValue(env.GITHUB_ENV, name, value);
}

function writeValue(file, name, value) {
  let delimiter;
  do { delimiter = `action_${randomUUID()}`; } while (String(value).includes(delimiter));
  appendFileSync(file, `${name}<<${delimiter}\n${value}\n${delimiter}\n`, 'utf8');
}

function fail(message) {
  process.stdout.write(`::error::${escapeCommand(message)}\n`);
  process.exitCode = 1;
}

module.exports = { input, mask, output, environment, fail, escapeCommand };
