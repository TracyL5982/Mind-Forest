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
# Momo's line as a tree a friend shared grows, in her realtime voice: demo/lines.json's said.shared and its one recording
# (test/sharing.test.ts checks this names the recording of the line as it is written now).
COPY demo/lines.json ./demo/lines.json
COPY demo/voice/voices.json demo/voice/4476cb447ce6a233e104.pcm ./demo/voice/
ENV MIND_PALACE_HOSTED=1 \
    MIND_PALACE_DATA=/data \
    MIND_PALACE_STARTER=/app/starter \
    MIND_PALACE_HOST=0.0.0.0 \
    MIND_PALACE_PORT=8080 \
    MIND_PALACE_ENV=/app/no-env-file
EXPOSE 8080
CMD ["node", "--no-warnings", "--import", "tsx", "src/node/main.ts"]
