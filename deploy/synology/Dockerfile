# Synology (Container Manager / Docker) 向け headless Tasken node
#
# 目的: Electronなしで Tasken Core を常時稼働させ、共有フォルダ同期の
# read-only replica として動かす（Issue #588 Phase 2）。
# 詳細手順は docs/synology-headless-node.md を参照する。
#
# build context はリポジトリ root:
#   docker build -f deploy/synology/Dockerfile -t tasken-headless:local .

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# electron-builder の postinstall をNode専用イメージで走らせない。
# esbuild は platform 依存の optional package、better-sqlite3 は install script が必要。
RUN npm ci --ignore-scripts \
  && npm rebuild esbuild better-sqlite3
COPY . .
RUN npm run build:core:headless \
  && npm run build:mcp \
  && npm prune --omit=dev

FROM node:24-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    TASKEN_USER_DATA_DIR=/data
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/core-dist ./core-dist
COPY --from=build /app/mcp-dist ./mcp-dist
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.env.TASKEN_USER_DATA_DIR+'/tasken-core.json','utf8'));fetch(d.origin+'/health',{headers:{authorization:'Bearer '+d.token}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "core-dist/headless.mjs"]
CMD ["--user-data-dir=/data"]
