# NAS の上で、main の固定 SHA のソースから Tasken の headless replica の image を作る（プル型の更新）。
# 中身は Dockerfile（開発機で作るもの）と同じ: Core（core-dist）・MCP bridge（mcp-dist）・tunnel-client。
# 加えて、入れ替えのときの検査（core-dist/replica-check.mjs）が入る。
#
# 実行役（nas-pull の nas-pull.sh）が GitHub の tarball を展開し、いま本番で動いている image から
# 写して NAS の固定の置き場に置いた tunnel-client を deploy/synology/nas-context/ に写してから
#   docker build -f deploy/synology/Dockerfile.nas --build-arg SOURCE_SHA=<sha> .
# を呼ぶ。nas-context/ は Git に入れない。
# tarball には .git が無いので、どの commit かは SOURCE_SHA を環境変数 TASKEN_SOURCE_SHA に埋めて残す
# （Core の READY の行と replica-check の出力に出る）。NAS の docker には buildx が無いので
# BuildKit を前提にしない（RUN --mount や COPY --chmod を使わない）。
#
# Dockerfile と違うところ:
# - tunnel-client を ghcr.io の latest から取らない。無人で作るので、版が勝手に変わらないように
# - better-sqlite3 を作り直さない。13 は N-API の prebuilds（linux-x64）を同梱していて Node の版に
#   依らない。新しい npm（11.19 など）は依存の install script を allowScripts で黙って飛ばすので、
#   作り直しに頼ると気づけない。代わりに build の中で開けることを確かめ、駄目なら BUILD_FAILED にする

FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# electron-builder の postinstall（Electron 向けの作り直し）を Node だけの image で走らせない。
RUN npm ci --ignore-scripts --no-audit --no-fund
COPY . .
ARG SOURCE_SHA
RUN test -n "$SOURCE_SHA"
RUN npm run build:core:headless \
  && npm run build:mcp \
  && npm prune --omit=dev --no-audit --no-fund \
  && node -e "const Database = require('better-sqlite3'); new Database(':memory:').close()" \
  && test -s core-dist/headless.mjs \
  && test -s core-dist/replica-check.mjs \
  && test -s core-dist/mobile-pair.mjs \
  && test -s mcp-dist/server.mjs \
  && test -s mcp-dist/http-server.mjs

FROM node:24-bookworm-slim AS runtime
ARG SOURCE_SHA
LABEL org.opencontainers.image.revision="${SOURCE_SHA}"
WORKDIR /app
ENV NODE_ENV=production \
    TASKEN_USER_DATA_DIR=/data \
    TASKEN_SOURCE_SHA=${SOURCE_SHA}
# tunnel-client / SDK が https を使うため、システム CA を含める。
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/core-dist ./core-dist
COPY --from=build /app/mcp-dist ./mcp-dist
# OpenAI Secure MCP Tunnel の client。いま本番の image から写して NAS に置いたもの（install-tasken.sh）。
COPY deploy/synology/nas-context/tunnel-client /usr/local/bin/tunnel-client
USER node
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(process.env.TASKEN_USER_DATA_DIR+'/tasken-core.json','utf8'));fetch(d.origin+'/health',{headers:{authorization:'Bearer '+d.token}}).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "core-dist/headless.mjs"]
CMD ["--user-data-dir=/data"]
