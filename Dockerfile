# =============================================================
#  Vision R+ Backend — Dockerfile
#  Node 20 LTS · NestJS · Prisma · argon2 (natif)
# =============================================================

FROM node:20-slim AS Builder ARG CACHEBUST=1
WORKDIR /app

# Outils de compilation pour les modules natifs (argon2)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

# Dépendances d'abord (layer cache)
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Générer le client Prisma
RUN npx prisma generate

# Code source + build TypeScript
COPY . .
RUN npm run build

# =============================================================
FROM node:20-slim AS production
WORKDIR /app

ENV NODE_ENV=production

# Outils natifs pour argon2 en prod
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
COPY prisma ./prisma/

# Installer toutes les deps (prisma CLI nécessaire pour migrate deploy)
RUN npm ci && npm cache clean --force

# Régénérer le client Prisma pour cette architecture
RUN npx prisma generate

# Application compilée depuis le stage builder
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Migrations au démarrage puis lancement de l'app
CMD ["sh", "-c", "node dist/src/main"]