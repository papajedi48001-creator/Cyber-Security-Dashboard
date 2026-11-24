# Security Operations Portal image for a local test install (deploy/local).
# Keeps the full dependency tree so prisma migrate and the admin script can run
# inside the container. Contains no configuration or secrets.
# The full bookworm image already has openssl, which Prisma needs.
FROM node:22-bookworm
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npx prisma generate && npm run build \
 && cp -r .next/static .next/standalone/.next/static \
 && if [ -d public ]; then cp -r public .next/standalone/public; fi
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3000
EXPOSE 3000
USER node
CMD ["sh", "-c", "npx prisma migrate deploy && npm run db:seed && node .next/standalone/server.js"]
