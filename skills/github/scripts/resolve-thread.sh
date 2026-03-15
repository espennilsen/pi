#!/usr/bin/env bash
# Reply to and resolve a PR review thread in one step.
#
# Usage: bash scripts/resolve-thread.sh <thread-id> <reply-body>
#
# Example:
#   bash scripts/resolve-thread.sh PRRT_kwDOROE4Hs50bONT "Fixed — added null guard"
#
# Note: This script is NOT idempotent. If the reply succeeds but resolve fails,
# re-running will post a duplicate reply. Callers that need retry logic should
# check for an existing reply before invoking, or call the resolve step separately.
set -euo pipefail

thread_id="${1:?Usage: resolve-thread.sh <thread-id> <reply-body>}"
reply_body="${2:?Usage: resolve-thread.sh <thread-id> <reply-body>}"

# Step 1: Reply to the thread
echo "→ Replying to thread ${thread_id}..."
reply_result=$(gh api graphql \
  -f query='
    mutation($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: {
        pullRequestReviewThreadId: $threadId,
        body: $body
      }) { comment { id } }
    }' \
  -f threadId="$thread_id" \
  -f body="$reply_body")

if echo "$reply_result" | jq -e '.errors' > /dev/null 2>&1; then
  echo "❌ Failed to reply to thread ${thread_id}." >&2
  echo "$reply_result" >&2
  exit 1
fi

# Step 2: Resolve the thread
echo "→ Resolving thread ${thread_id}..."
result=$(gh api graphql \
  -f query='
    mutation($threadId: ID!) {
      resolveReviewThread(input: {
        threadId: $threadId
      }) { thread { isResolved } }
    }' \
  -f threadId="$thread_id")

if echo "$result" | jq -e '.errors' > /dev/null 2>&1; then
  echo "❌ Failed to resolve thread ${thread_id}." >&2
  echo "$result" >&2
  exit 1
fi

resolved=$(echo "$result" | jq -r '.data.resolveReviewThread.thread.isResolved')
if [ "$resolved" = "true" ]; then
  echo "✅ Thread ${thread_id} resolved."
else
  echo "❌ Failed to resolve thread ${thread_id}." >&2
  echo "$result" >&2
  exit 1
fi
