#!/usr/bin/env bash
set -euo pipefail

if [[ -n "$(git status --porcelain)" ]]; then
  echo "工作区不干净，请先提交或暂存改动。" >&2
  exit 1
fi

base="integration/backend-control-plane"
if ! git show-ref --verify --quiet "refs/heads/$base"; then
  echo "缺少集成分支 $base" >&2
  exit 1
fi

git fetch upstream --tags
branch="sync/upstream-$(date +%F)"
git switch "$base"
git switch -c "$branch"
git merge upstream/main

cat <<'EOF'
同步分支已创建。请完成冲突处理后运行：
  cd web && bun test src/services/control-plane src/services/cloud-sync && bun run typecheck
  docker run --rm -e GOPROXY=https://goproxy.cn,direct -v "$HOME/.cache/go-build:/root/.cache/go-build" -v "$HOME/go/pkg/mod:/go/pkg/mod" -v "$PWD/server:/src" -w /src golang:1.25 go test ./...
  docker compose -f docker-compose.control-plane.yml config
EOF
