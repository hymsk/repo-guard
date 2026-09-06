#!/usr/bin/env bash
set -euo pipefail
target=all
action=install
apply=()
selected=0
for arg in "$@"; do
  case "$arg" in
    --codex|--claude|--opencode|--all)
      if [[ "$selected" == 1 ]]; then echo 'Select exactly one target.' >&2; exit 2; fi
      target="${arg#--}"; selected=1 ;;
    --uninstall) action=uninstall ;;
    --apply) apply=(--apply) ;;
    --local) ;; # compatibility spelling; local is now the only mode
    -h|--help) echo 'Usage: bash install.sh [--codex|--claude|--opencode|--all] [--uninstall] [--apply] [--local]'; echo 'Dry-run by default; --apply delegates to native plugin installation.'; exit 0 ;;
    *) echo 'Unknown installer argument.' >&2; exit 2 ;;
  esac
done
node_bin="${REPO_GUARD_NODE:-node}"
"$node_bin" -e 'if(Number(process.versions.node.split(".")[0])<22){console.error("Node.js >=22 required");process.exit(1)}'
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec "$node_bin" "$script_dir/scripts/agent-plugin.mjs" "$action" --host "$target" "${apply[@]}"
