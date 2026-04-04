FROM node:20-alpine AS builder
WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

FROM node:20-alpine
WORKDIR /app

COPY package*.json ./
# RUN npm ci --omit=dev

# copy node_modules từ builder thay vì cài lại
COPY --from=builder /app/node_modules ./node_modules

# xoá dev dependencies
RUN npm prune --omit=dev

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/main.js"]

FROM python:3.10-slim

WORKDIR /app

# copy file requirements trước để cache
COPY requirements.txt .

RUN pip install --no-cache-dir -r requirements.txt

COPY . .

CMD ["python", "app.py"]