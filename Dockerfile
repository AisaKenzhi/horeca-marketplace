# ------------------------------------------------------------------
# HoReCa Marketplace — P0 prototype, local dev image.
#
# This image is for LOCAL development only. It runs the Vite dev server and
# must never be published or deployed as a public site. Nothing here contacts
# any external service.
# ------------------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund

# Copy the rest of the project.
COPY . .

EXPOSE 5173

# Bind to 0.0.0.0 so the port is reachable from the host when run in Docker.
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]
