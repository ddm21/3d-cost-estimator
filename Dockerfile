FROM node:22-bullseye-slim AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bullseye-slim
WORKDIR /app

# Install dependencies for running OrcaSlicer headless (AppImage extraction and runtime libs)
# xvfb is required to run GUI apps headlessly if they require an X server
RUN apt-get update && apt-get install -y \
    wget \
    curl \
    unzip \
    libglu1-mesa \
    libgtk-3-0 \
    libegl1 \
    libwebkit2gtk-4.0-37 \
    libglw1-mesa \
    xvfb \
    libosmesa6 \
    && rm -rf /var/lib/apt/lists/*

# Download OrcaSlicer AppImage and extract it so it runs without FUSE in Docker
WORKDIR /slicer
RUN wget -q "https://github.com/SoftFever/OrcaSlicer/releases/download/v2.1.1/OrcaSlicer_Linux_V2.1.1.AppImage" -O orcaslicer.AppImage \
    && chmod +x orcaslicer.AppImage \
    && ./orcaslicer.AppImage --appimage-extract \
    && rm orcaslicer.AppImage

# Create a wrapper script to run OrcaSlicer headlessly via xvfb
RUN echo '#!/bin/bash\nexport GDK_BACKEND=x11\nxvfb-run -a /slicer/squashfs-root/AppRun "$@"' > /usr/local/bin/orcaslicer \
    && chmod +x /usr/local/bin/orcaslicer

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist

# Create a temp directory for slicer uploads and gcode
RUN mkdir -p /app/tmp_uploads && chmod 777 /app/tmp_uploads

EXPOSE 4321
ENV HOST=0.0.0.0
ENV PORT=4321

CMD ["node", "./dist/server/entry.mjs"]
