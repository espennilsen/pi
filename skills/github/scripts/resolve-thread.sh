#!/usr/bin/env bash
# Resolve a PR review thread (mark as resolved).
#
# Usage: bash scripts/resolve-thread.sh <thread-id>
#
# Example:
#   bash scripts/resolve-thread.sh PRRT_kwDOROE4Hs50bONT
#
# Idempotent: Resolving an already-resolved thread is a no-op.
# Safe to retry on failure.
#
# To reply AND resolve, call reply-thread.sh first:
#   bash scripts/reply-thread.sh THREAD_ID "Fixed — description"
#   bash scripts/resolve-thread.sh THREAD_ID
set -euo pipefail

thread_id="${1:?Usage: resolve-thread.sh <thread-id>}"

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
