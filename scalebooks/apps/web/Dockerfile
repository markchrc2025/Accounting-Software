# Sentire Books web (Vite SPA) — build the static bundle, serve it with nginx.
#
# IMPORTANT: Vite inlines every VITE_* variable at BUILD time, not runtime. All
# three below are PUBLIC values (the Supabase publishable key is RLS-protected and
# already shipped to browsers), so they are safe to bake into the image. Set them
# as Build Arguments in Sliplane; the defaults here are used if you don't.
#
# Sliplane service settings:
#   Build context : scalebooks
#   Dockerfile    : apps/web/Dockerfile
#   Port          : 80
#   Build args    : VITE_API_BASE_URL (your API's Sliplane URL), VITE_SUPABASE_*

# ---- build stage ----
FROM node:20-slim AS build
RUN npm install -g pnpm@9
WORKDIR /app
COPY . .
RUN pnpm install --frozen-lockfile

ARG VITE_API_BASE_URL="https://REPLACE-with-your-api.sliplane.app"
ARG VITE_SUPABASE_URL="https://mqsdymealtdrzmbnvvoc.supabase.co"
ARG VITE_SUPABASE_PUBLISHABLE_KEY="sb_publishable_roR2UnE41AKs4Qwb8fQuKQ_nHp8EgKD"
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY

RUN pnpm --filter @scalebooks/web build

# ---- serve stage ----
FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
