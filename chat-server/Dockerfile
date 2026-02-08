FROM denoland/deno:alpine

WORKDIR /app

COPY deno.json ./
COPY server.ts ./

# Cache dependencies
RUN deno cache server.ts

EXPOSE 3001

CMD ["deno", "run", "--allow-net", "--allow-env", "server.ts"]
