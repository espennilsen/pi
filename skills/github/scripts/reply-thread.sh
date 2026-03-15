#!/usr/bin/env bash
# Reply to a PR review thread.
#
# Usage: bash scripts/reply-thread.sh <thread-id> <reply-body>
#
# Example:
#   bash scripts/reply-thread.sh PRRT_kwDOROE4Hs50bONT "Fixed — added null guard"
#
# Idempotency: This script is NOT idempotent — re-running will post a
# duplicate reply. Callers that need retry logic should check for an
# existing reply (e.g. via fetch-threads.sh) before invoking.
set -euo pipefail

thread_id="${1:?Usage: reply-thread.sh <thread-id> <reply-body>}"
reply_body="${2:?Usage: reply-thread.sh <thread-id> <reply-body>}"

echo "→ Replying to thread ${thread_id}..."
result=$(gh api graphql \
  -f query='
    mutation($threadId: ID!, $body: String!) {
      addPullRequestReviewThreadReply(input: {
        pullRequestReviewThreadId: $threadId,
        body: $body
      }) { comment { id } }
    }' \
  -f threadId="$thread_id" \
  -f body="$reply_body")

if echo "$result" | jq -e '.errors' > /dev/null 2>&1; then
  echo "❌ Failed to reply to thread ${thread_id}." >&2
  echo "$result" >&2
  exit 1
fi

echo "✅ Replied to thread ${thread_id}."
