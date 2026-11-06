#!/usr/bin/env bash
# Runs the CI jobs of .github/workflows/pages.yml on this computer, with the same commands.
#
#   scripts/ci-local.sh static|unit|build|e2e|visual   one job (npm run ci:<job>)
#   scripts/ci-local.sh all                            every job in CI order, then the gate
#                                                      (npm run ci); a summary at the end
#
# Differences from CI, by necessity:
#   static  the commit identity check uses ALLOWED_COMMIT_EMAILS when it is set, otherwise the
#           identity configured in this clone (git config user.email) plus noreply@github.com,
#           and checks the commits not on origin/main (or main..HEAD without origin/main).
#   e2e     runs the three Chromium shards one after the other; the WebKit job runs only when
#           the Playwright WebKit browser is installed (npx playwright install webkit).
#   visual  runs natively; CI runs it in the pinned Playwright Docker image. With
#           BCPS_VISUAL_DOCKER=1 it runs in that image here too (needs Docker and the image).
# Nothing here pushes, deploys or uses credentials.
set -uo pipefail

cd "$(dirname "$0")/.."

PLAYWRIGHT_IMAGE="mcr.microsoft.com/playwright:v1.63.0-noble"

step() {
  echo
  echo "── $*"
  "$@"
}

job_static() {
  step npx tsc -b &&
    step npx biome ci . &&
    step node scripts/check-layers.ts &&
    step node scripts/check-banned.ts &&
    step npx vitest run tests/unit/check-banned.test.ts &&
    identity &&
    step node scripts/check-content.ts &&
    step node scripts/check-state-version.ts
}

identity() {
  local allowed="${ALLOWED_COMMIT_EMAILS:-}"
  if [[ -z "$allowed" ]]; then
    allowed="$(git config user.email),noreply@github.com"
    echo
    echo "── check-commit-identity: ALLOWED_COMMIT_EMAILS not set; using this clone's identity"
  fi
  if git rev-parse --verify --quiet origin/main >/dev/null; then
    step env ALLOWED_COMMIT_EMAILS="$allowed" GITHUB_EVENT_NAME= bash scripts/check-commit-identity.sh
  else
    step env ALLOWED_COMMIT_EMAILS="$allowed" GITHUB_EVENT_NAME= bash scripts/check-commit-identity.sh --range main..HEAD
  fi
}

job_unit() {
  step npx vitest run
}

job_build() {
  step npx vite build &&
    step npx vite build --mode single &&
    step node scripts/assemble-site.mjs &&
    step node scripts/check-budgets.ts &&
    step node scripts/check-banned.ts --manifest dist/manifest.webmanifest
}

need_site() {
  if [[ ! -f _site/next/index.html ]]; then
    echo "ci-local: _site/ is missing; run the build job first (scripts/ci-local.sh build)" >&2
    return 1
  fi
}

webkit_installed() {
  local dir
  dir="$(npx playwright install --dry-run webkit 2>/dev/null | awk '/Install location/ {print $3; exit}')"
  [[ -n "$dir" && -d "$dir" ]]
}

job_e2e() {
  need_site || return 1
  local shard
  for shard in 1/3 2/3 3/3; do
    step env BCPS_PREBUILT_SITE=1 npx playwright test --project=chromium --shard="$shard" --pass-with-no-tests || return 1
  done
  if webkit_installed; then
    step env BCPS_PREBUILT_SITE=1 npx playwright test --project=webkit --shard=1/1 --pass-with-no-tests
  else
    echo
    echo "── webkit: skipped here (the Playwright WebKit browser is not installed); CI runs it"
    SKIPPED+=("e2e webkit")
  fi
}

job_visual() {
  need_site || return 1
  if [[ "${BCPS_VISUAL_DOCKER:-}" == "1" ]]; then
    step docker run --rm -e BCPS_PREBUILT_SITE=1 -e CI=1 -v "$PWD":/work -w /work "$PLAYWRIGHT_IMAGE" \
      npx playwright test --project=visual --pass-with-no-tests
  else
    echo
    echo "── visual: native run (CI uses $PLAYWRIGHT_IMAGE; BCPS_VISUAL_DOCKER=1 runs that image)"
    SKIPPED+=("visual in Docker")
    step env BCPS_PREBUILT_SITE=1 npx playwright test --project=visual --pass-with-no-tests
  fi
}

SKIPPED=()
declare -a RESULTS=()

run_job() {
  local name="$1" start end status
  start=$(date +%s)
  echo
  echo "════ job: $name"
  "job_$name"
  status=$?
  end=$(date +%s)
  if ((status == 0)); then
    RESULTS+=("$name: success ($((end - start)) s)")
  else
    RESULTS+=("$name: failure ($((end - start)) s)")
  fi
  return $status
}

case "${1:-}" in
  static | unit | build | e2e | visual)
    run_job "$1"
    exit $?
    ;;
  all)
    failed=0
    run_job static || failed=1
    run_job unit || failed=1
    if run_job build; then
      run_job e2e || failed=1
      run_job visual || failed=1
    else
      failed=1
      RESULTS+=("e2e: skipped (build failed)" "visual: skipped (build failed)")
    fi
    echo
    echo "════ summary"
    for r in "${RESULTS[@]}"; do echo "  $r"; done
    for s in "${SKIPPED[@]+"${SKIPPED[@]}"}"; do echo "  not run here: $s"; done
    if ((failed == 0)); then
      echo "  gate: success"
    else
      echo "  gate: failure"
    fi
    exit $failed
    ;;
  *)
    echo "usage: scripts/ci-local.sh static|unit|build|e2e|visual|all" >&2
    exit 2
    ;;
esac
