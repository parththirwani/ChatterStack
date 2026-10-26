# Repository workflow

## Features and bug fixes

- When the user requests a new feature or bug fix, start a new branch from the latest `origin/dev` before changing code. Use a short `feature/<name>` or `fix/<name>` branch name. Keep unrelated work out of that branch.
- If there are uncommitted changes, preserve them before switching branches. Never discard or silently carry unrelated changes into the working branch.
- Commit coherent checkpoints as work progresses, without asking the user for permission. Use descriptive commit messages and push checkpoints to the working branch so earlier states remain available. Do not wait until the whole task is finished to make the first commit. Do not squash or force-push away checkpoint history unless the user asks.
- Implement and test the change on that branch. Share a feature with the user for review; when they say they are satisfied, create a pull request with `dev` as its base. For a bug fix, create the pull request once the fix is verified and ready for review. Every feature and bug fix must have a pull request. Include the tests run and any known limits in its description.
- Do not merge the pull request unless the user asks for it. Do not push feature or bug-fix commits directly to `dev` unless the user explicitly instructs you to do so.

## Existing work

- Follow the user's explicit branch or PR instructions when they differ from the default feature workflow above.
- Before committing, check the diff for secrets and generated files. Run the relevant checks for the changed code.
