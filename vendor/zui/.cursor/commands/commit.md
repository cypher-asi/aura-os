# Commit

Create a git commit following these steps:

1. Run `git status` to see all untracked and modified files
2. Run `git diff` to see both staged and unstaged changes that will be committed
3. Run `git log --oneline -5` to see recent commit messages for style reference
4. Analyze all changes and draft a commit message that:
   - Summarizes the nature of changes (new feature, enhancement, bug fix, refactor, test, docs, etc.)
   - Is concise (1-2 sentences) focusing on "why" rather than "what"
   - Does NOT commit files containing secrets (.env, credentials, etc.)
5. Stage relevant files with `git add`
6. Commit using the drafted message
7. Run `git status` after commit to verify success
8. Push to remote with `git push` (use `git push -u origin main` for first push if needed)
