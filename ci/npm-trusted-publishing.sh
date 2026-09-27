#!/usr/bin/env bash
# The npm that publishes this package, in one place: provided (`ensure`) and
# demanded (`assert`).
#
# Trusted publishing to npm (signing in with the run's OIDC token instead of a
# stored token) exists from npm 11.5.1 on. Older versions never ask for the
# token: they go straight to the ordinary login, find nothing and answer
# ENEEDAUTH, which reads like a broken trusted publisher and is really an old
# toolchain.
#
# Hence two verbs instead of one step:
#
#   ensure   Provides a version at or above the floor. It runs AFTER the Node
#            setup: `actions/setup-node` puts its own Node, with the npm bundled
#            beside it, in front of the PATH, so an upgrade made before it is
#            silently replaced. Installs under `$RUNNER_TEMP` and hands the path
#            to the following steps through `$GITHUB_PATH`.
#
#   assert   Refuses when the npm on the PATH is below the floor. It belongs IN
#            the publish step, before `npm publish`, in the same shell: nothing
#            can be reordered between two lines of one step.
#
# The floor is not a safety margin but the version in which npm gained the
# method. Lowering it does not make the publish more tolerant; it takes away
# the login.
#
#   bash ci/npm-trusted-publishing.sh ensure
#   bash ci/npm-trusted-publishing.sh assert
#   bash ci/npm-trusted-publishing.sh --self-test   # no network
#
# Exit: 0 fine · 1 the version is too old · 64 wrong call
set -euo pipefail

# npm 11.5.1 is the first version with trusted publishing.
FLOOR=11.5.1

# `sort -V` orders version numbers; if the floor comes first, the measured
# version is equal or greater.
at_or_above() {
  [ "$(printf '%s\n%s\n' "$FLOOR" "$1" | sort -V | head -1)" = "$FLOOR" ]
}

ensure() {
  local have prefix
  have="$(npm --version)"
  if at_or_above "$have"; then
    echo "npm $have can do trusted publishing (floor $FLOOR), nothing to do."
    return 0
  fi

  echo "npm $have is older than $FLOOR, fetching the newest one for Node $(node --version)."
  prefix="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/npm-trusted-publishing"
  mkdir -p "$prefix"

  # `--engine-strict` lets npm itself refuse a version this Node cannot carry,
  # instead of installing it and dying on the first call (npm 12 needs
  # `^22.22.2 || ^24.15.0 || >=26`). The fallback takes the last major version
  # that is sure to reach the floor.
  npm install -g --engine-strict --prefix "$prefix" npm@latest \
    || npm install -g --engine-strict --prefix "$prefix" npm@11

  export PATH="$prefix/bin:$PATH"
  have="$(npm --version)"
  if ! at_or_above "$have"; then
    echo "::error::npm $have cannot do trusted publishing. Node $(node --version) carries no version from $FLOOR on; only a newer Node helps here."
    return 1
  fi

  if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$prefix/bin" >>"$GITHUB_PATH"
  else
    echo "Note: no \$GITHUB_PATH, the following steps will not see npm $have. Outside a workflow run that is expected."
  fi
  echo "npm $have under $prefix/bin"
}

assert() {
  local have
  have="$(npm --version)"
  if at_or_above "$have"; then
    echo "npm $have ($(command -v npm)) can do trusted publishing."
    return 0
  fi
  echo "::error::npm $have ($(command -v npm)) is below $FLOOR and cannot do trusted publishing. A publish from here fails with ENEEDAUTH and reads like a broken trusted publisher. Expected: a step running \`npm-trusted-publishing.sh ensure\` AFTER the Node setup."
  return 1
}

# The counter-check. It tests the comparison, not the network: every listed
# version is judged, and the half below the floor MUST be refused. Otherwise
# this would be a gate that cannot fail.
self_test() {
  local bad=0 v
  for v in 11.5.1 11.7.0 12.0.2 11.6.0 100.0.0; do
    if at_or_above "$v"; then
      echo "  accepted: $v"
    else
      echo "SELF-TEST FAILED: $v is at or above $FLOOR and was refused"
      bad=$((bad + 1))
    fi
  done
  for v in 10.9.8 10.8.2 11.5.0 9.9.9 6.14.18; do
    if at_or_above "$v"; then
      echo "SELF-TEST FAILED: $v is below $FLOOR and was accepted"
      bad=$((bad + 1))
    else
      echo "  refused: $v"
    fi
  done
  if [ "$bad" -gt 0 ]; then
    echo ""
    echo "$bad cases judged wrongly."
    return 1
  fi
  echo ""
  echo "Self-test passed: floor $FLOOR, 5 accepted, 5 refused."
}

case "${1:-}" in
  ensure) ensure ;;
  assert) assert ;;
  --self-test) self_test ;;
  *)
    echo "usage: $0 ensure|assert|--self-test" >&2
    exit 64
    ;;
esac
