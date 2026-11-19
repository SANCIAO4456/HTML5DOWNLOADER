FROM node:22-slim

WORKDIR /app

COPY package.json ./
COPY backend/package*.json ./backend/
COPY frontend/package*.json ./frontend/

RUN npm ci --prefix backend && npm ci --prefix frontend

COPY backend ./backend
COPY frontend ./frontend

RUN npm run build

ENV NODE_ENV=production
ENV PORT=3001

EXPOSE 3001

CMD ["npm", "start"]
