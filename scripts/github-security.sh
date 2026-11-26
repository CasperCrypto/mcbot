#!/usr/bin/env bash
# Switch on the GitHub settings that protect McBot's code and releases (SECURITY.md, "Settings for
# maintainers"). Safe to run again: it sets the same values and updates its two rulesets in place.
#
#   gh auth login                          # once, as an admin of the repository
#   bash scripts/github-security.sh        # --dry-run only lists what it would set
#
# Needs the GitHub CLI (https://cli.github.com; on a Mac: brew install gh). It talks only to GitHub's
# API, with your own sign-in; nothing is stored. A step GitHub refuses is reported and the rest go on.
set -uo pipefail

REPO="${MCBOT_REPO:-CasperCrypto/mcbot}"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1
ACTIONS_APP=15368 # GitHub Actions' app id: required checks must come from Actions, not any status
ADMIN_ROLE=5      # the "Repository admin" role, as rulesets name it

done_n=0
failed=()
step() { # $1 = what it does, then `gh api` arguments (a JSON body comes on stdin with --input -)
  local what="$1"
  shift
  if [ "$DRY" = 1 ]; then
    printf '  · %s\n' "$what"
    return
  fi
  local out
  if out=$(gh api "$@" 2>&1); then
    printf '  ✓ %s\n' "$what"
    done_n=$((done_n + 1))
  else
    printf '  ✗ %s\n      %s\n' "$what" "$(printf '%s' "$out" | tr '\n' ' ' | cut -c1-200)"
    failed+=("$what")
  fi
}

ruleset() { # $1 = name; the JSON body on stdin. Updates the ruleset of that name, or creates it.
  local name="$1" body id
  body=$(cat)
  id=$(gh api "repos/$REPO/rulesets" --paginate --jq ".[] | select(.name == \"$name\") | .id" 2>/dev/null | head -n 1)
  if [ -n "$id" ]; then
    printf '%s' "$body" | step "$name (updated)" -X PUT "repos/$REPO/rulesets/$id" --input -
  else
    printf '%s' "$body" | step "$name" -X POST "repos/$REPO/rulesets" --input -
  fi
}

command -v gh >/dev/null 2>&1 || { echo "Install the GitHub CLI first: https://cli.github.com (on a Mac: brew install gh)"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "Sign in first: gh auth login"; exit 1; }
if [ "$DRY" = 0 ]; then
  [ "$(gh api "repos/$REPO" --jq .permissions.admin 2>/dev/null)" = "true" ] || { echo "$(gh api user --jq .login 2>/dev/null || echo "This account") is not an admin of $REPO."; exit 1; }
fi
echo "GitHub security settings for $REPO$([ "$DRY" = 1 ] && echo " (dry run: nothing changes)")"

echo "Merges and branches"
step "squash merging only (each pull request lands as one commit GitHub signs)" -X PATCH "repos/$REPO" \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false
step "delete a pull request's branch once it is merged" -X PATCH "repos/$REPO" -F delete_branch_on_merge=true

echo "Code security"
step "secret scanning, with push protection (a key is stopped before it reaches GitHub)" -X PATCH "repos/$REPO" --input - <<'JSON'
{ "security_and_analysis": { "secret_scanning": { "status": "enabled" }, "secret_scanning_push_protection": { "status": "enabled" } } }
JSON
step "Dependabot alerts (known vulnerabilities in dependencies)" -X PUT "repos/$REPO/vulnerability-alerts"
step "Dependabot security updates (a pull request that fixes one)" -X PUT "repos/$REPO/automated-security-fixes"
step "private vulnerability reporting (SECURITY.md's \"Report a vulnerability\")" -X PUT "repos/$REPO/private-vulnerability-reporting"

echo "GitHub Actions"
step "only GitHub's own actions, plus the ones listed below" -X PUT "repos/$REPO/actions/permissions" --input - <<'JSON'
{ "enabled": true, "allowed_actions": "selected" }
JSON
step "listed: tauri-apps/tauri-action (builds the installers)" -X PUT "repos/$REPO/actions/permissions/selected-actions" --input - <<'JSON'
{ "github_owned_allowed": true, "verified_allowed": false, "patterns_allowed": ["tauri-apps/tauri-action@*"] }
JSON
step "workflows get a read-only token unless they ask; Actions may open pull requests (the engine update)" \
  -X PUT "repos/$REPO/actions/permissions/workflow" --input - <<'JSON'
{ "default_workflow_permissions": "read", "can_approve_pull_request_reviews": true }
JSON
step "a person approves workflows on every outside contributor's pull request" \
  -X PUT "repos/$REPO/actions/permissions/fork-pr-contributor-approval" --input - <<'JSON'
{ "approval_policy": "all_external_contributors" }
JSON

echo "Rulesets"
# The default branch: no deleting it, no rewriting its history, no change without a pull request whose
# checks passed, every commit signed. An admin may still merge a pull request whose checks GitHub never
# started (the engine update's, opened by a workflow), but never push around a pull request.
ruleset "Protect main" <<JSON
{
  "name": "Protect main",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": $ADMIN_ROLE, "actor_type": "RepositoryRole", "bypass_mode": "pull_request" }],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    { "type": "required_signatures" },
    { "type": "pull_request", "parameters": {
        "required_approving_review_count": 0,
        "dismiss_stale_reviews_on_push": false,
        "require_code_owner_review": false,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false } },
    { "type": "required_status_checks", "parameters": {
        "strict_required_status_checks_policy": false,
        "required_status_checks": [
          { "context": "test", "integration_id": $ACTIONS_APP },
          { "context": "windows", "integration_id": $ACTIONS_APP },
          { "context": "dependencies", "integration_id": $ACTIONS_APP },
          { "context": "analyze (javascript-typescript)", "integration_id": $ACTIONS_APP },
          { "context": "analyze (actions)", "integration_id": $ACTIONS_APP }
        ] } }
  ]
}
JSON
# Release tags: once a version is out, its tag never moves or disappears. Creating one stays open:
# publishing a release creates its tag, and release.yml builds nothing from a commit not on main.
ruleset "Protect release tags" <<JSON
{
  "name": "Protect release tags",
  "target": "tag",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["refs/tags/v*"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": $ADMIN_ROLE, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [{ "type": "update" }, { "type": "deletion" }]
}
JSON

echo "Website"
step "mcbot.studio only over HTTPS (install.sh is served from there)" -X PUT "repos/$REPO/pages" -F https_enforced=true

echo
if [ "$DRY" = 1 ]; then
  echo "Dry run: nothing was changed. Run it without --dry-run to apply."
else
  echo "$done_n settings applied, ${#failed[@]} refused."
  for f in "${failed[@]}"; do echo "  still to do by hand: $f (Settings at https://github.com/$REPO/settings)"; done
fi
cat <<EOF

Only you can do these (a script can't):
  1. Two-factor sign-in with a passkey or an authenticator app: https://github.com/settings/security
  2. Verify mcbot.studio for your account, so nobody else can publish under it: https://github.com/settings/pages
EOF
