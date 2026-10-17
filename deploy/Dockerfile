FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json ./
RUN npm install
COPY frontend/ ./
RUN npm run build

FROM nginx:1.27-alpine
RUN apk add --no-cache openssl
COPY --from=build /app/dist /usr/share/nginx/html
COPY deploy/nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY deploy/nginx/cert-sync.sh /usr/local/bin/cert-sync.sh
COPY deploy/nginx/10-certs.sh /docker-entrypoint.d/10-certs.sh
RUN chmod +x /usr/local/bin/cert-sync.sh /docker-entrypoint.d/10-certs.sh
