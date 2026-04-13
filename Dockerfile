FROM node:20-alpine

RUN apk add --no-cache \
    fontconfig \
    ttf-dejavu

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

RUN mkdir -p /app/data

ENV NODE_ENV=production
ENV DB_PATH=/app/data/inventory.db
ENV SESSION_PATH=/app/data/sessions.json

VOLUME ["/app/data"]

CMD ["node", "src/app.js"]
