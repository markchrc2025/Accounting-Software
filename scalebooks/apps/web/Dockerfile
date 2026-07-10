# Sentire Books web (Vite SPA) — build the static bundle, serve it with nginx.
#
# IMPORTANT: Vite inlines every VITE_* variable at BUILD time, not runtime. Both
# below are PUBLIC values (the API URL and the Authenticize base URL), safe to
# bake into the image. Set them as Build Arguments in Sliplane; the defaults here
# are used if you don't.
#
# Sliplane service settings:
#   Build context : scalebooks
#   Dockerfile    : apps/web/Dockerfile
#   Port          : 80
#   Build args    : VITE_API_BASE_URL (your API's URL), VITE_AUTH_URL (Authenticize URL)

# ---- build stage ----
FROM node:20-slim AS build
RUN npm install -g pnpm@9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

ARG VITE_API_BASE_URL="https://REPLACE-with-your-api.sliplane.app"
ARG VITE_AUTH_URL="https://REPLACE-with-your-authenticize.example.com"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_AUTH_URL=$VITE_AUTH_URL

RUN pnpm --filter @scalebooks/web build

# ---- serve stage ----
FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
