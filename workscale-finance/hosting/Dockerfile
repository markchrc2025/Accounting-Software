# Sentire Books portal (the full-featured UI, formerly Firebase-hosted) —
# build the static Vite bundle, serve it with nginx.
#
# CONTEXT-AGNOSTIC: platforms differ on what they pass as the Docker build
# context (the repo root vs the directory containing this Dockerfile). The
# Sliplane deploys showed the context arriving WITHOUT the workscale-finance/
# prefix, so this build copies whatever context it receives and locates the
# app inside it — it works either way.
#
# IMPORTANT: Vite inlines VITE_* variables at BUILD time, not runtime. Set
# VITE_API_BASE_URL in the Sliplane service's Environment Variables — it is a
# PUBLIC value (the API origin), safe to bake in. There is deliberately NO
# default: the build FAILS if it's unset rather than shipping a bundle that
# points the login flow at a non-existent host.
#
# Sliplane service settings:
#   Dockerfile path : workscale-finance/hosting/Dockerfile
#   Env / build arg : VITE_API_BASE_URL = your API origin
#                     (e.g. https://sentire-books-api.sliplane.app)

# ---- build stage ----
FROM node:20-slim AS build
COPY . /ctx
RUN set -e; \
    if   [ -f /ctx/workscale-finance/hosting/package.json ]; then src=/ctx/workscale-finance/hosting; \
    elif [ -f /ctx/hosting/package.json ];                   then src=/ctx/hosting; \
    elif [ -f /ctx/package.json ];                           then src=/ctx; \
    else echo "ERROR: package.json not found in the build context — expected the repo root or workscale-finance/hosting as the context." >&2; exit 1; fi; \
    mkdir -p /app && cp -a "$src/." /app/
WORKDIR /app
RUN npm ci

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
# Everything comes via the build stage — this stage never reads the context.
COPY --from=build /app/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
