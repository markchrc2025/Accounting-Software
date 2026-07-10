# Sentire Books API — Hono on Node, run directly via tsx (there is no compiled
# JS output; `build` is a typecheck only).
#
# Built with the REPO ROOT as the Docker context (Sliplane's default), so it
# copies the pnpm workspace out of the monorepo subfolder.
#
# Sliplane service settings:
#   Dockerfile path : scalebooks/apps/api/Dockerfile
#   (leave the build context / base directory at the repo root — the default)
FROM node:20-slim

# Match the repo's pinned package manager (packageManager: pnpm@9.12.0).
RUN npm install -g pnpm@9

WORKDIR /app

# Copy just the pnpm workspace (the root .dockerignore trims node_modules, the
# legacy app, etc.). tsx is a devDependency needed at runtime, so install ALL
# deps — do NOT set NODE_ENV=production before install.
COPY scalebooks/ ./
RUN pnpm install --frozen-lockfile

# The server reads $PORT (falls back to 8787) and binds 0.0.0.0; Sliplane detects
# the exposed port from this instruction.
EXPOSE 8787

CMD ["pnpm", "--filter", "@scalebooks/api", "start"]
