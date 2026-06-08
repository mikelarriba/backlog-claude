# Stage 1: install dependencies and typecheck
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run typecheck

# Stage 2: production image
FROM node:20-alpine AS runtime
WORKDIR /app

RUN addgroup -S midas && adduser -S midas -G midas

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

# docs/ and inbox/ are externally mounted; create dirs so they exist at startup
RUN mkdir -p docs/features docs/epics docs/stories docs/spikes docs/bugs inbox

USER midas
EXPOSE 3000

CMD ["node", "--import", "tsx/esm", "server.ts"]
