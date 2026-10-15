# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:24-bookworm-slim
ARG GO_IMAGE=golang:1.27.2-bookworm

FROM ${NODE_IMAGE} AS web-build
WORKDIR /build/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM ${GO_IMAGE} AS server-build
ENV CGO_ENABLED=0 GOTOOLCHAIN=local
WORKDIR /build/server
COPY server/go.mod server/go.sum ./
RUN go mod download && go mod verify
COPY server/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/ghost-chat ./cmd/ghostchat

FROM scratch AS runtime
WORKDIR /app
COPY --from=server-build /out/ghost-chat /app/ghost-chat
COPY --from=web-build /build/web/dist /app/web
COPY LICENSE /app/LICENSE
COPY --from=server-build /usr/local/go/LICENSE /app/licenses/go.txt
COPY --from=server-build /go/pkg/mod/github.com/coder/websocket@v1.8.15/LICENSE.txt /app/licenses/coder-websocket.txt
COPY --from=web-build /build/web/node_modules/react/LICENSE /app/licenses/react.txt
COPY --from=web-build /build/web/node_modules/react-dom/LICENSE /app/licenses/react-dom.txt
COPY --from=web-build /build/web/node_modules/scheduler/LICENSE /app/licenses/scheduler.txt
COPY --from=web-build /build/web/node_modules/lucide-react/LICENSE /app/licenses/lucide-react.txt
COPY --from=web-build /build/web/node_modules/jsonc-parser/LICENSE.md /app/licenses/jsonc-parser.txt
COPY --from=web-build /build/web/node_modules/qrcode/license /app/licenses/qrcode.txt
COPY --from=web-build /build/web/node_modules/dijkstrajs/LICENSE.md /app/licenses/dijkstrajs.txt
COPY --from=web-build /build/web/node_modules/vite/LICENSE.md /app/licenses/vite.txt
ENV ADDR=0.0.0.0:8080 WEB_DIST_DIR=/app/web
USER 65532:65532
EXPOSE 8080
ENTRYPOINT ["/app/ghost-chat"]
