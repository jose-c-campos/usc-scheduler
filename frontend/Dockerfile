# Build stage
FROM node:20-alpine AS build
WORKDIR /app

# Install deps and build
COPY ./frontend/package*.json ./
COPY ./frontend .
RUN npm ci && npm run build

# Runtime stage
FROM nginx:alpine
# Static files
COPY --from=build /app/dist /usr/share/nginx/html
# nginx.conf is mounted via compose
EXPOSE 80
