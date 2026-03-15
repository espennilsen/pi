#!/usr/bin/env bash
# Reply to and resolve a PR review thread in one step.
#
# Usage: bash scripts/resolve-thread.sh <thread-id> <reply-body>
#
# Example:
#   bash scripts/resolve-thread.sh PRRT_kwDOROE4Hs50bONT "Fixed — added null guard"
set -euo pipefail

thread_id="${1:?Usage: resolve-thread.sh <thread-id> <reply-body>}"
reply_body="${2:?Usage: resolve-thread.sh <thread-id> <reply-body>}"

# Step 1: Reply to the thread
echo "→ Replying to thread ${thread_id}..."
gh api graphql -f query="
mutation {
  addPullRequestReviewThreadReply(input: {
    pullRequestReviewThreadId: \"${thread_id}\",
    body: $(jq -Rn --arg b "$reply_body" '$b')
  }) { comment { id } }
}" > /dev/null

# Step 2: Resolve the thread
echo "→ Resolving thread ${thread_id}..."
result=$(gh api graphql -f query="
mutation {
  resolveReviewThread(input: {
    threadId: \"${thread_id}\"
  }) { thread { isResolved } }
}")

resolved=$(echo "$result" | jq -r '.data.resolveReviewThread.thread.isResolved')
if [ "$resolved" = "true" ]; then
  echo "✅ Thread ${thread_id} resolved."
else
  echo "❌ Failed to resolve thread ${thread_id}." >&2
  echo "$result" >&2
  exit 1
fi
