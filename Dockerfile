FROM node:20-alpine AS base

# Install fonts for PNG report generation
RUN apk add --no-cache \
    fontconfig \
    ttf-dejavu \
    ttf-liberation

WORKDIR /app

# ---- dependencies ----
FROM base AS deps
COPY package*.json ./
RUN npm ci --omit=dev

# ---- release ----
FROM base AS release
COPY --from=deps /app/node_modules ./node_modules
RUN find /app -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} +
COPY . .
RUN node scripts/setup-fonts.js || true

RUN mkdir -p /app/logs

ENV NODE_ENV=production

CMD ["node", "src/app.js"]
