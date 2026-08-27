FROM node:20-bookworm-slim AS build
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
# redis-memory-server is a local-dev helper; skip compiling Redis in Docker.
ENV REDISMS_DISABLE_POSTINSTALL=true
# Copy the full tree before install so pnpm workspace links are not wiped by a later COPY.
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm exec turbo run build --filter=@memecoinbot/api...

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
COPY --from=build /app /app
EXPOSE 3001
CMD ["pnpm", "--filter", "@memecoinbot/api", "start:prod"]
