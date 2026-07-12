# Sentire Books portal (the full-featured UI, formerly Firebase-hosted) —
# build the static Vite bundle, serve it with nginx.
#
# Built with the REPO ROOT as the Docker context (Sliplane's default).
#
# IMPORTANT: Vite inlines VITE_* variables at BUILD time, not runtime. Sliplane
# passes service env vars to the build, so set VITE_API_BASE_URL in the service's
# Environment Variables — it is a PUBLIC value (the API origin), safe to bake in.
#
# There is deliberately NO default: shipping a placeholder produces a bundle that
# points the login flow at a non-existent host. The build FAILS if it's unset.
#
# Sliplane service settings (this replaces the old scalebooks/apps/web service):
#   Dockerfile path : workscale-finance/hosting/Dockerfile
#   (leave the build context / base directory at the repo root — the default)
#   Env / build arg : VITE_API_BASE_URL = your API origin
#                     (e.g. https://sentire-books-api.sliplane.app)

# ---- build stage ----
FROM node:20-slim AS build
WORKDIR /app
COPY workscale-finance/hosting/package.json workscale-finance/hosting/package-lock.json ./
RUN npm ci
COPY workscale-finance/hosting/ ./

ARG VITE_API_BASE_URL=""
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

# Fail loudly on a missing/placeholder API URL rather than baking a broken bundle.
RUN case "$VITE_API_BASE_URL" in \
      "" | *REPLACE* | *example.com*) \
        echo "ERROR: VITE_API_BASE_URL must be set to your API origin (e.g. https://sentire-books-api.sliplane.app). Set it in the Sliplane web service's Environment Variables." >&2; \
        exit 1;; \
    esac

RUN npm run build

# ---- serve stage ----
FROM nginx:1.27-alpine
COPY workscale-finance/hosting/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
