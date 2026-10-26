# Repository workflow

## New features

- When the user requests a new feature, start a new branch from the latest `origin/dev` before changing code. Use a short `feature/<name>` branch name. Keep unrelated work out of that branch.
- If there are uncommitted changes, preserve them before switching branches. Never discard or silently carry unrelated changes into the new feature branch.
- Implement and test the feature on that branch. Share the result with the user for review.
- When the user says they are satisfied with the feature, push the feature branch and create a pull request with `dev` as its base. Include the tests run and any known limits in the PR description.
- Do not merge the pull request unless the user asks for it. Do not push feature commits directly to `dev` unless the user explicitly instructs you to do so.

## Existing work

- Follow the user's explicit branch or PR instructions when they differ from the default feature workflow above.
- Before committing, check the diff for secrets and generated files. Run the relevant checks for the changed code.
