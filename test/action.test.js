'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, writeFileSync, readFileSync, rmSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, isAbsolute } = require('node:path');
const { run, formatNotes } = require('../src/action');

function fixture(t, message = 'Fix publishing\n\nPreserve **details**.\n\nCo-authored-by: Someone <someone@example.com>\n') {
  const root = mkdtempSync(join(tmpdir(), 'notes-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const repo = join(root, 'repo with spaces');
  mkdirSync(repo);
  const git = args => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true });
  git(['init', '-q']);
  git(['config', 'user.name', 'Test Author']);
  git(['config', 'user.email', 'test@example.com']);
  git(['config', 'commit.gpgsign', 'false']);
  const commit = text => {
    const file = join(root, 'message');
    writeFileSync(file, text);
    git(['-c', 'core.hooksPath=', 'commit', '--allow-empty', '--allow-empty-message', '--cleanup=verbatim', '-q', '-F', file]);
    return git(['rev-parse', 'HEAD']).trim();
  };
  const sha = commit(message);
  return { root, repo, git, commit, sha, env: { GITHUB_WORKSPACE: repo, RUNNER_TEMP: root, GITHUB_OUTPUT: join(root, 'output'), GITHUB_ENV: join(root, 'env') } };
}

function parse(file) {
  const lines = readFileSync(file, 'utf8').split('\n');
  const values = {};
  for (let i = 0; i < lines.length && lines[i]; i++) {
    const [name, delimiter] = lines[i].split('<<');
    assert.ok(delimiter);
    const value = [];
    while (lines[++i] !== delimiter) { assert.ok(i < lines.length); value.push(lines[i]); }
    values[name] = value.join('\n');
  }
  return values;
}

test('matches existing latest-commit notes, exports environment, and writes a UTF-8 file', async t => {
  const f = fixture(t);
  await run(f.env);
  const out = parse(f.env.GITHUB_OUTPUT);
  assert.equal(out.notes, 'Fix publishing\n\nPreserve **details**.');
  assert.equal(out['package-release-notes'], out.notes);
  assert.equal(out['commit-sha'], f.sha);
  assert.equal(parse(f.env.GITHUB_ENV).PACKAGE_RELEASE_NOTES, out.notes);
  assert.ok(isAbsolute(out['notes-file']));
  assert.equal(readFileSync(out['notes-file'], 'utf8'), out.notes + '\n');
});

test('preserves Unicode, leading spaces, Markdown, trailers other than exact coauthor lines', () => {
  assert.equal(formatNotes('  Title 🚀\r\n\r\n- café\r\nco-authored-by: retained\r\nSigned-off-by: kept\r\nCo-authored-by: removed\r\n\r\n'),
    '  Title 🚀\n\n- café\nco-authored-by: retained\nSigned-off-by: kept');
});

test('commit message content cannot inject environment variables or output fields', async t => {
  const message = 'Title\n\n::error::not executed\nEVIL=value\nEOF\nnotes<<delimiter\n$(echo unsafe)\n';
  const f = fixture(t, message);
  await run(f.env);
  assert.deepEqual(Object.keys(parse(f.env.GITHUB_ENV)), ['PACKAGE_RELEASE_NOTES']);
  assert.equal(parse(f.env.GITHUB_OUTPUT).notes, message.trimEnd());
});

test('can retain coauthors and disable environment export', async t => {
  const f = fixture(t);
  f.env['INPUT_STRIP-COAUTHORS'] = 'false';
  f.env['INPUT_EXPORT-ENV'] = 'false';
  delete f.env.GITHUB_ENV;
  await run(f.env);
  assert.match(parse(f.env.GITHUB_OUTPUT).notes, /Co-authored-by:/);
});

test('reads the requested tag rather than latest commit and supports repository input', async t => {
  const f = fixture(t, 'First release');
  f.git(['tag', 'v1']);
  f.commit('Second release');
  f.env.GITHUB_WORKSPACE = f.root;
  f.env.INPUT_REPOSITORY = 'repo with spaces';
  f.env.INPUT_REF = 'v1';
  await run(f.env);
  assert.equal(parse(f.env.GITHUB_OUTPUT).notes, 'First release');
  assert.equal(parse(f.env.GITHUB_OUTPUT)['commit-sha'], f.sha);
});

test('missing and option-shaped refs fail with a checkout hint', async t => {
  const f = fixture(t);
  for (const ref of ['does-not-exist', '--help', '--output=unexpected']) {
    f.env.INPUT_REF = ref;
    await assert.rejects(run(f.env), /ensure the requested ref was fetched/);
  }
});

test('empty notes are preserved, including coauthor-only messages', async t => {
  const f = fixture(t, 'Co-authored-by: Someone\n');
  await run(f.env);
  assert.equal(parse(f.env.GITHUB_OUTPUT).notes, '');
});

test('invalid booleans and missing environment file fail before git', async t => {
  const f = fixture(t);
  f.env['INPUT_EXPORT-ENV'] = 'maybe';
  await assert.rejects(run(f.env), /true or false/);
  delete f.env['INPUT_EXPORT-ENV'];
  delete f.env.GITHUB_ENV;
  await assert.rejects(run(f.env), /GITHUB_ENV/);
});

test('repeated executions append outputs and use distinct notes files', async t => {
  const f = fixture(t);
  await run(f.env);
  const first = parse(f.env.GITHUB_OUTPUT)['notes-file'];
  await run(f.env);
  const second = parse(f.env.GITHUB_OUTPUT)['notes-file'];
  assert.notEqual(first, second);
  assert.equal(readFileSync(first, 'utf8'), readFileSync(second, 'utf8'));
});
