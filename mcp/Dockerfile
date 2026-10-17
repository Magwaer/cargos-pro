FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev
COPY src ./src
ENV NODE_ENV=production
ENV MCP_TRANSPORT=http
ENV MCP_PORT=3100
ENV MCP_AUTH_PATH=/data/auth.json
VOLUME ["/data"]
EXPOSE 3100
CMD ["node", "src/index.js"]
