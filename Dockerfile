FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY apps/mobile/package.json apps/mobile/
COPY packages ./packages
# redis-memory-server is a local-dev helper; skip compiling Redis in Docker.
ENV REDISMS_DISABLE_POSTINSTALL=true
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm --filter @memecoinbot/api... build

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=build /app /app
EXPOSE 3001
CMD ["pnpm", "--filter", "@memecoinbot/api", "start:prod"]
