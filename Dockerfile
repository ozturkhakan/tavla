# Node app + GNU Backgammon (used headless for game analysis).
FROM node:22-bookworm-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends gnubg \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

ENV NODE_ENV=production \
    GNUBG_BIN=/usr/games/gnubg
EXPOSE 3000
CMD ["node", "server.js"]
