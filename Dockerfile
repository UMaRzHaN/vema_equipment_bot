FROM node:20-alpine

RUN apk add --no-cache \
    fontconfig \
    ttf-dejavu

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data /app/logs

ENV NODE_ENV=production
ENV DB_PATH=/app/data/inventory.db
ENV SESSION_PATH=/app/data/sessions.json

VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('./src/db'); process.exit(0)" || exit 1

CMD ["node", "src/app.js"]
