# Runs TS directly via tsx (same as the "start" npm script), so no build stage is needed.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3001

CMD ["npx", "tsx", "server.ts"]
