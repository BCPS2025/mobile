#!/usr/bin/env bash
# Checks that the author AND committer email of every new commit is on the allowlist.
#
# Allowlist: ALLOWED_COMMIT_EMAILS (an Actions repository variable, not a secret), separated by
# commas, spaces or newlines. It must include noreply@github.com (commits made in the web UI).
#
# Which commits (history is never rescanned):
#   push          PUSH_BEFORE..PUSH_AFTER. When PUSH_BEFORE is all zeros (first push of a branch)
#                 or unknown (after a force push): for main (PUSH_REF, else GITHUB_REF), every
#                 commit reachable from PUSH_AFTER, because the checkout's origin/main already
#                 is PUSH_AFTER; for any other branch, the commits not reachable from origin/main
#   pull_request  the pull request's commits: PR_BASE_SHA..PR_HEAD_SHA
#   other events  nothing to check
#   local run     --range <A..B>, or by default the commits not reachable from origin/main
#
# Needs the full history (actions/checkout with fetch-depth: 0).
# Usage: ALLOWED_COMMIT_EMAILS="a@example.org,noreply@github.com" scripts/check-commit-identity.sh [--range A..B]
set -euo pipefail

die() {
  echo "check-commit-identity: $*" >&2
  exit 1
}

is_sha() { [[ "$1" =~ ^[0-9a-f]{40}$ ]]; }
is_zero() { [[ "$1" =~ ^0+$ ]]; }
known() { git cat-file -e "$1^{commit}" 2>/dev/null; }

allowed_raw="${ALLOWED_COMMIT_EMAILS:-}"
[[ -n "${allowed_raw//[[:space:],]/}" ]] || die "ALLOWED_COMMIT_EMAILS is empty; set the repository variable (Settings > Secrets and variables > Actions > Variables)."

declare -a allowed=()
for e in ${allowed_raw//,/ }; do
  allowed+=("$(printf '%s' "$e" | tr '[:upper:]' '[:lower:]')")
done

is_allowed() {
  local email
  email="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  local a
  for a in "${allowed[@]}"; do [[ "$email" == "$a" ]] && return 0; done
  return 1
}

not_on_main() {
  # Commits of $1 that origin/main does not already contain.
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    git rev-list "$1" --not origin/main
  else
    die "origin/main is not available; fetch it (actions/checkout with fetch-depth: 0)."
  fi
}

range=""
if [[ "${1:-}" == "--range" ]]; then
  [[ -n "${2:-}" ]] || die "--range needs a value such as main..HEAD"
  range="$2"
fi

commits=""
event="${GITHUB_EVENT_NAME:-}"
if [[ -n "$range" ]]; then
  commits="$(git rev-list "$range")"
elif [[ "$event" == "push" ]]; then
  before="${PUSH_BEFORE:-}"
  after="${PUSH_AFTER:-}"
  is_sha "$after" || die "PUSH_AFTER is not a commit SHA"
  if is_sha "$before" && ! is_zero "$before" && known "$before"; then
    commits="$(git rev-list "$before..$after")"
  else
    ref="${PUSH_REF:-${GITHUB_REF:-}}"
    if [[ "$ref" == "refs/heads/main" ]]; then
      # origin/main is the pushed commit here: "not on origin/main" would check nothing.
      echo "check-commit-identity: no usable previous commit on main; checking its whole history"
      commits="$(git rev-list "$after")"
    else
      echo "check-commit-identity: no usable previous commit; checking commits not on origin/main"
      commits="$(not_on_main "$after")"
    fi
  fi
elif [[ "$event" == "pull_request" ]]; then
  base="${PR_BASE_SHA:-}"
  head="${PR_HEAD_SHA:-}"
  is_sha "$base" && is_sha "$head" || die "PR_BASE_SHA / PR_HEAD_SHA are not commit SHAs"
  commits="$(git rev-list "$base..$head")"
elif [[ -n "$event" ]]; then
  echo "check-commit-identity: event '$event' adds no commits; nothing to check"
  exit 0
else
  commits="$(not_on_main HEAD)"
fi

count=0
bad=0
while IFS= read -r sha; do
  [[ -n "$sha" ]] || continue
  count=$((count + 1))
  author="$(git show -s --format='%ae' "$sha")"
  committer="$(git show -s --format='%ce' "$sha")"
  # The offending address is not printed: it would stay in the public build log.
  if ! is_allowed "$author"; then
    echo "  $sha: author email is not on the allowlist" >&2
    bad=$((bad + 1))
  fi
  if ! is_allowed "$committer"; then
    echo "  $sha: committer email is not on the allowlist" >&2
    bad=$((bad + 1))
  fi
done <<<"$commits"

if ((bad > 0)); then
  echo "check-commit-identity: $bad problem(s) in $count commit(s)." >&2
  echo "Inspect locally with: git log --format='%H %ae / %ce' <range>. See CONTRIBUTING.md (commit identity)." >&2
  exit 1
fi
echo "check-commit-identity: $count commit(s) checked, all identities allowed"
