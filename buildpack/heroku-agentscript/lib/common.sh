# shellcheck shell=bash
# Shared helpers for the AgentScript buildpack.

bp_log() {
  echo "-----> $*"
}

bp_indent() {
  sed -u 's/^/       /'
}

bp_resolve_version() {
  local build_dir="$1"
  local version_file="$build_dir/.agentscript-version"
  if [ -f "$version_file" ]; then
    tr -d '[:space:]' < "$version_file"
  else
    echo "latest"
  fi
}

bp_has_agent_files() {
  local dir="$1"
  if compgen -G "$dir/*.agent" > /dev/null; then
    return 0
  fi
  if [ -d "$dir/agents" ] && compgen -G "$dir/agents/*.agent" > /dev/null; then
    return 0
  fi
  return 1
}
