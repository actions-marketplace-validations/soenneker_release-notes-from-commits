'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { mkdtemp, writeFile, appendFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const { input, output, environment } = require('./runtime');

const execute = promisify(execFile);

function boolean(value, fallback, name) {
  if (!value) return fallback;
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false.`);
  return value === 'true';
}

function formatNotes(message, stripCoauthors = true) {
  const normalized = message.replaceAll('\r\n', '\n');
  // Match the existing sed '/^Co-authored-by:/d' behavior, including case sensitivity.
  const lines = normalized.split('\n').filter(line => !stripCoauthors || !line.startsWith('Co-authored-by:'));
  // Bash command substitution removes trailing newlines, but preserves other whitespace.
  return lines.join('\n').replace(/\n+$/, '');
}

async function run(env = process.env) {
  const strip = boolean(input('strip-coauthors', env), true, 'strip-coauthors');
  const exportEnv = boolean(input('export-env', env), true, 'export-env');
  const ref = input('ref', env) || 'HEAD';
  if (!env.GITHUB_OUTPUT) throw new Error('GITHUB_OUTPUT is unavailable. Run this action in a GitHub Actions step.');
  if (exportEnv && !env.GITHUB_ENV) throw new Error('GITHUB_ENV is unavailable. Set export-env to false if only outputs are needed.');
  try {
    await appendFile(env.GITHUB_OUTPUT, '');
    if (exportEnv) await appendFile(env.GITHUB_ENV, '');
  } catch { throw new Error('GitHub output or environment files are not writable.'); }
  const cwd = resolve(env.GITHUB_WORKSPACE || process.cwd(), input('repository', env) || '.');
  const git = async args => (await execute('git', args, {
    cwd, encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024, windowsHide: true,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat' }
  })).stdout;
  let sha;
  try { sha = (await git(['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])).trim(); }
  catch { throw new Error('Cannot resolve ref to a local commit. Run actions/checkout first and ensure the requested ref was fetched.'); }
  if (!/^[a-f0-9]{40,64}$/.test(sha)) throw new Error('Git returned an invalid commit identifier.');
  let message;
  try { message = await git(['-c', 'log.showSignature=false', 'log', '-1', '--encoding=UTF-8', '--format=%B', sha, '--']); }
  catch { throw new Error('Cannot read the commit message. Git commands are limited to 30 seconds and 1 MiB of output.'); }
  if (message.includes('\0')) throw new Error('The commit message contains a NUL character and cannot be exported.');
  const notes = formatNotes(message, strip);
  // GitHub measures job outputs approximately as UTF-16. Leave space for the other outputs.
  if (Buffer.byteLength(notes, 'utf16le') * 2 > 800000)
    throw new Error('Release notes are too large for the action outputs. Shorten the commit message.');
  const directory = await mkdtemp(join(env.RUNNER_TEMP || tmpdir(), 'release-notes-'));
  const file = join(directory, 'release-notes.txt');
  await writeFile(file, `${notes}\n`, { encoding: 'utf8', flag: 'wx' });
  if (exportEnv) environment('PACKAGE_RELEASE_NOTES', notes, env);
  output('notes', notes, env);
  output('package-release-notes', notes, env);
  output('notes-file', file, env);
  output('commit-sha', sha, env);
  // Commit messages are untrusted text and may contain workflow commands; never log them.
  process.stdout.write(`Generated release notes from commit ${sha.slice(0, 12)} (${Buffer.byteLength(notes)} UTF-8 bytes).\n`);
}

module.exports = { run, formatNotes };
