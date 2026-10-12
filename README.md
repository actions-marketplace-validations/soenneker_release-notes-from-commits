# Release Notes From Commits

Generate release notes from the full message of the checked-out commit. Runs on GitHub's Node 24 action runtime with no npm dependencies. Git must be installed and the repository checked out.

The default behavior matches the existing Soenneker publishing workflows:

```bash
git log -1 --pretty=%B | sed '/^Co-authored-by:/d'
```

It preserves the subject, body, Markdown, Unicode, and internal whitespace; removes lines starting exactly with `Co-authored-by:`; and trims trailing newlines like Bash command substitution. CRLF line endings are normalized to LF. It exports `PACKAGE_RELEASE_NOTES` for subsequent steps in the same job. Empty notes remain empty.

## Usage

After the first release is published, use `@v1` below or pin a released commit SHA. Until then, check out this action alongside your project and use its local directory.

```yaml
- uses: actions/checkout@v7

- name: Get release notes from latest commit
  id: notes
  uses: soenneker/release-notes-from-commits@v1

# Existing build/pack steps can keep using PACKAGE_RELEASE_NOTES.

- name: Create GitHub release
  env:
    GH_TOKEN: ${{ secrets.GH__TOKEN }}
    RELEASE_TAG: v${{ env.BUILD_VERSION }}
    NOTES_FILE: ${{ steps.notes.outputs.notes-file }}
  shell: bash
  run: gh release create "$RELEASE_TAG" --title "$RELEASE_TAG" --notes-file "$NOTES_FILE"
```

The action itself only reads local Git history and writes local files. Release creation and its permissions remain in the consuming workflow. Do not interpolate commit message outputs directly into shell scripts; use the environment variable or the generated file.

## Inputs

| Input | Default | Purpose |
| --- | --- | --- |
| `ref` | `HEAD` | Local commit, branch, or tag whose single commit message supplies the notes |
| `repository` | `.` | Repository directory relative to `GITHUB_WORKSPACE`, or an absolute path |
| `strip-coauthors` | `true` | Remove exact, case-sensitive `Co-authored-by:` lines anywhere in the message |
| `export-env` | `true` | Export `PACKAGE_RELEASE_NOTES` to later steps |

Boolean values must be `'true'` or `'false'`. The selected ref must already exist locally; the action never fetches or changes the checkout. The default works with a depth-one checkout. Fetch additional history or tags when selecting another ref. On pull requests, `HEAD` may be GitHub's generated merge commit; explicitly select and fetch the desired commit if you need the PR head message.

## Outputs

| Output | Value |
| --- | --- |
| `notes` | Cleaned full commit message |
| `package-release-notes` | Identical text, suitable for your existing package metadata flow; Markdown is preserved |
| `notes-file` | Absolute path to a UTF-8 file ending with one newline |
| `commit-sha` | Full SHA resolved before reading the message |

The file is created in a unique temporary directory under `RUNNER_TEMP` (or the OS temp directory) and remains available to later steps on the same runner. To use it in another job, upload it as an artifact. No files in the repository are overwritten.

Commit message contents are never printed to the log or executed. Outputs and the environment variable use collision-checked multiline delimiters. Git runs without a shell, with a 30-second timeout and 1 MiB output limit; notes are also bounded to leave room within GitHub's output limits. A missing ref, unreadable repository, invalid option, or oversized message fails explicitly.

This version intentionally generates notes from one commit to preserve the current release process. It does not calculate versions, aggregate a commit range, rewrite text with AI, create releases, or change package publishing.
