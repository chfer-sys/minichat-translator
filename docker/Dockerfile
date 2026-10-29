# Build context: repo root (see docker-compose.yml web service).
# Builds the static PERSONA app into nginx — no bind mounts at runtime.

FROM nginx:alpine

# Same-origin API base baked into the generated config.js. The browser calls
# /api/chat/completions; nginx strips /api and forwards to the internal proxy
# container, which injects OPENCODE_GO_API_KEY server-side.
ARG API_BASE_URL=/api

# Replace the default vhost (SPA fallback + /api reverse proxy).
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Static app surface only — never the whole repo.
COPY index.html manifest.json sw.js icon-192.png icon-512.png /usr/share/nginx/html/
COPY src /usr/share/nginx/html/src

# Runtime config (ESM, imported by src/*.js). apiKey stays empty on purpose:
# the real key exists only in the proxy container.
RUN printf "export const baseUrl = '%s';\nexport const apiKey = '';\n" "$API_BASE_URL" \
    > /usr/share/nginx/html/config.js

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
