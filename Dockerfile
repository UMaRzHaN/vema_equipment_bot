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
COPY . .

RUN mkdir -p /app/logs

ENV NODE_ENV=production

CMD ["node", "src/app.js"]
