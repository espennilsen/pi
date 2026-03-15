# PR Create — Create PR with Generated Summary

Create a pull request with an LLM-generated title and description.

## Quick Path

```
/gh-pr-create [base-branch]
```

Default base: `main`. Must be on a feature branch (not main/master).

The command:

1. Checks no PR already exists for the branch
2. Pushes the branch to origin
3. Gathers commits, diff stat, and full diff
4. Sends context to the LLM as a follow-up message
5. LLM drafts a title and description
6. **Presents the draft to the user for review before creating**
7. Creates the PR via `gh pr create`

## Manual Workflow

```bash
# Push the branch
git push -u origin <branch>

# Gather context
git log main..<branch> --pretty=format:"%h %s" --reverse
git diff main...<branch> --stat
git diff main...<branch>

# Create PR
gh pr create --base main --title "..." --body "..."
```

## PR Description Guidelines

- Start with a concise summary of what and why
- List key changes as bullet points
- Keep it factual — no filler
- Call out breaking changes explicitly
- Use markdown formatting

## Conventions

- Always push before creating the PR
- Check for existing PRs on the branch first
- Present draft to user before running `gh pr create`
- Truncate diff at 50KB if too large
