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

# Paginate through all review threads
all_threads='[]'
pr_meta=""
cursor=""
has_next="true"

while [ "$has_next" = "true" ]; do
  cursor_args=()
  if [ -n "$cursor" ]; then
    cursor_args=(-f cursor="$cursor")
  fi

  response=$(gh api graphql \
    -f query="$query" \
    -F owner="$owner" \
    -F repo="$repo" \
    -F prNumber="$pr_number" \
    ${cursor_args[@]+"${cursor_args[@]}"})

  # Extract PR metadata on first page
  if [ -z "$pr_meta" ]; then
    pr_meta=$(echo "$response" | jq '{
      number: .data.repository.pullRequest.number,
      title: .data.repository.pullRequest.title,
      branch: .data.repository.pullRequest.headRefName,
      url: .data.repository.pullRequest.url
    }')
  fi

  # Append this page's thread nodes
  page_threads=$(echo "$response" | jq '[.data.repository.pullRequest.reviewThreads.nodes[]]')
  all_threads=$(jq -n --argjson existing "$all_threads" --argjson page "$page_threads" '$existing + $page')

  # Check pagination
  has_next=$(echo "$response" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.hasNextPage')
  cursor=$(echo "$response" | jq -r '.data.repository.pullRequest.reviewThreads.pageInfo.endCursor')
done

# Filter to unresolved threads with at least one comment, output clean JSON
jq -n --argjson pr "$pr_meta" --argjson threads "$all_threads" '{
  pr: $pr,
  threads: [
    $threads[]
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
