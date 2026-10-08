# Runs TS directly via tsx (same as the "start" npm script), so no build stage is needed.
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

EXPOSE 3010

# node as PID 1 (not npx/tsx wrappers) so SIGTERM reaches the shutdown handler.
CMD ["node", "--import", "tsx", "server.ts"]
