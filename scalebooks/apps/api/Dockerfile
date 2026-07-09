# Sentire Books API — Hono on Node, run directly via tsx (there is no compiled
# JS output; `build` is a typecheck only). The API imports the workspace packages
# @scalebooks/db and @scalebooks/domain, so the whole pnpm workspace must be in
# the build context.
#
# Sliplane service settings:
#   Build context : scalebooks
#   Dockerfile    : apps/api/Dockerfile
#   Port          : 8787
FROM node:20-slim

# Match the repo's pinned package manager (packageManager: pnpm@9.12.0).
RUN npm install -g pnpm@9

WORKDIR /app

# Copy the whole workspace (.dockerignore keeps node_modules/dist/.env out) and
# install ALL deps — tsx is a devDependency and is required at runtime, so do NOT
# set NODE_ENV=production before install (that would prune it).
COPY . .
RUN pnpm install --frozen-lockfile

# The server reads $PORT (Sliplane) and binds 0.0.0.0; 8787 is the local default.
EXPOSE 8787

CMD ["pnpm", "--filter", "@scalebooks/api", "start"]
