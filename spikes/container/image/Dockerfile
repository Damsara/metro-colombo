FROM node:22.22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
WORKDIR /app
RUN npm init -y >/dev/null && npm install @duckdb/node-api@1.5.6-r.1
RUN node -e 'import("@duckdb/node-api").then(async (d) => { const c = await (await d.DuckDBInstance.create(":memory:")).connect(); await c.run("INSTALL httpfs"); })'
COPY compact.mjs ./
EXPOSE 8080
CMD ["node", "compact.mjs"]
