#!/usr/bin/env bash
# Fetch unresolved PR review threads via GraphQL.
#
# Usage: bash scripts/fetch-threads.sh <owner> <repo> <pr-number>
# Output: JSON array of unresolved threads with id, path, line, and comments.
#
# Example:
#   bash scripts/fetch-threads.sh espennilsen pi 96
set -euo pipefail

owner="${1:?Usage: fetch-threads.sh <owner> <repo> <pr-number>}"
repo="${2:?Usage: fetch-threads.sh <owner> <repo> <pr-number>}"
pr_number="${3:?Usage: fetch-threads.sh <owner> <repo> <pr-number>}"

query='
query($owner: String!, $repo: String!, $prNumber: Int!, $cursor: String) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $prNumber) {
      number
      title
      headRefName
      url
      reviewThreads(first: 100, after: $cursor) {
        pageInfo { hasNextPage endCursor }
        nodes {
          id
          isResolved
          path
          line
          comments(first: 20) {
            nodes {
              author { login }
              body
              createdAt
            }
          }
        }
      }
    }
  }
}'

response=$(gh api graphql \
  -f query="$query" \
  -F owner="$owner" \
  -F repo="$repo" \
  -F prNumber="$pr_number")

# Filter to unresolved threads with at least one comment, output clean JSON
echo "$response" | jq '{
  pr: {
    number: .data.repository.pullRequest.number,
    title: .data.repository.pullRequest.title,
    branch: .data.repository.pullRequest.headRefName,
    url: .data.repository.pullRequest.url
  },
  threads: [
    .data.repository.pullRequest.reviewThreads.nodes[]
    | select(.isResolved == false)
    | select(.comments.nodes | length > 0)
    | {
        id: .id,
        path: .path,
        line: .line,
        author: .comments.nodes[0].author.login,
        body: .comments.nodes[0].body,
        replies: [.comments.nodes[1:][] | {author: .author.login, body: .body}]
      }
  ]
}'
