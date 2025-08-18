# Build stage
FROM node:20-bookworm AS builder
WORKDIR /app

# System deps for C++ and libpq
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential cmake libpq-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

# Copy sources
COPY ./scheduler ./scheduler
COPY ./server ./server

# Build C++ scheduler
# libpq headers are under /usr/include/postgresql on Debian/Ubuntu
RUN mkdir -p /app/scheduler/build && \
    g++ -O3 -std=c++17 /app/scheduler/*.cpp \
       -I/usr/include/postgresql -L/usr/lib \
       -lpq -pthread \
       -o /app/scheduler/build/scheduler

# Runtime stage
FROM node:20-bookworm AS api
WORKDIR /app

# Runtime libpq
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && \
    rm -rf /var/lib/apt/lists/*

# Copy server and binary
COPY --from=builder /app/server /app/server
COPY --from=builder /app/scheduler/build /app/scheduler/build

WORKDIR /app/server
RUN npm ci --omit=dev

ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "server.js"]
