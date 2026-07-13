# Stage 1: install all deps, typecheck, build frontend
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck
RUN npm run build:frontend

# Stage 2: production image — install prod deps only (tsx is now a prod dep)
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S midas && adduser -S midas -G midas

COPY package*.json ./
RUN npm ci --omit=dev

# Copy application source and compiled frontend assets
COPY --from=builder /app/src ./src
COPY --from=builder /app/server.ts ./server.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/index.html ./index.html
COPY --from=builder /app/sw.js ./sw.js
COPY --from=builder /app/manifest.json ./manifest.json

# docs/ and inbox/ are externally mounted; create dirs so they exist at startup
RUN mkdir -p docs/features docs/epics docs/stories docs/spikes docs/bugs inbox

USER midas
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/docs || exit 1

CMD ["node", "--import", "tsx/esm", "server.ts"]
