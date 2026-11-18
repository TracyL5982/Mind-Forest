# The hosted service for judging ("Hosted for judging" in agents/README.md). Built on Fly's remote builder from the agents folder.
FROM node:22.13.0-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
# tsx runs the TypeScript as on the Mac, so the dev dependencies come along.
RUN npm ci --no-audit --no-fund
COPY tsconfig.json ./
COPY src ./src
# The core measures text with the web client's own card code.
COPY client/js ./client/js
COPY starter ./starter
# Momo's lines in her realtime voice, each with its one recording: demo/lines.json's said.shared, as a tree a friend shared grows,
# and the refusals the service says itself (RECORDED_LINES in src/node/hosted/hosted.ts). test/sharing.test.ts and
# test/hosted.test.ts check this names the recording of each line as it is written now.
COPY demo/lines.json ./demo/lines.json
COPY demo/voice/voices.json demo/voice/4476cb447ce6a233e104.pcm demo/voice/e6c870ac6271abd0d0b8.pcm demo/voice/38b739aea0e2f61fc254.pcm demo/voice/185cae8aa77b0a13a5db.pcm demo/voice/af1a5ee404a1ae1285e7.pcm demo/voice/d78dd914bde32de87aa7.pcm demo/voice/5f72465a0705561df2ad.pcm demo/voice/99c679802766fee8d26e.pcm demo/voice/db94fe3d2b839db6f8f0.pcm ./demo/voice/
ENV MIND_PALACE_HOSTED=1 \
    MIND_PALACE_DATA=/data \
    MIND_PALACE_STARTER=/app/starter \
    MIND_PALACE_HOST=0.0.0.0 \
    MIND_PALACE_PORT=8080 \
    MIND_PALACE_ENV=/app/no-env-file
EXPOSE 8080
CMD ["node", "--no-warnings", "--import", "tsx", "src/node/main.ts"]
