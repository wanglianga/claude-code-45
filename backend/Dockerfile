# ---------- 构建阶段 ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json .npmrc* ./
RUN npm install --no-audit --no-fund
COPY tsconfig*.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

# ---------- 运行阶段 ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone || true
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=5s --start-period=40s --retries=10 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "dist/main.js"]
