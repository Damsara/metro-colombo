import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { DuckDBInstance } from "@duckdb/node-api";

const source = process.env.SOURCE ?? "https://data.metro.manasa.ai/today/date=2026-10-12/through=20.parquet?v=1791815858384";
const repeat = Number(process.env.REPEAT ?? 1);
const memoryLimit = process.env.DUCKDB_MEMORY ?? "600MB";
const threads = process.env.DUCKDB_THREADS ?? "2";

const vmHwmMb = () => {
  const line = readFileSync("/proc/self/status", "utf8").split("\n").find((l) => l.startsWith("VmHWM"));
  return line ? Math.round(Number(line.match(/\d+/)[0]) / 1000) : undefined;
};

const cgroupPeakMb = () => {
  for (const path of ["/sys/fs/cgroup/memory.peak", "/sys/fs/cgroup/memory/memory.max_usage_in_bytes"]) {
    try {
      return Math.round(Number(readFileSync(path, "utf8")) / 1e6);
    } catch {}
  }
  return undefined;
};

const input = Array.from({ length: repeat }, () => `SELECT * FROM read_parquet('${source}')`).join(" UNION ALL ");

createServer(async (_request, response) => {
  const started = Date.now();
  try {
    const db = await DuckDBInstance.create(":memory:", { memory_limit: memoryLimit, threads, temp_directory: "/tmp/duckdb-spill" });
    const con = await db.connect();
    await con.run("INSTALL httpfs; LOAD httpfs;");
    await con.run(`COPY (
      SELECT * FROM (${input})
      QUALIFY row_number() OVER (PARTITION BY bus_id, coalesce(reported_at, -received_at) ORDER BY received_at) = 1
      ORDER BY bus_id, coalesce(reported_at, received_at)
    ) TO '/tmp/out.parquet' (FORMAT parquet, COMPRESSION zstd, ROW_GROUP_SIZE 100000)`);
    const result = await con.runAndReadAll("SELECT count(*) AS n FROM '/tmp/out.parquet'");
    response.end(JSON.stringify({
      ok: true,
      rows: Number(result.getRowObjects()[0].n),
      ms: Date.now() - started,
      vmHwmMb: vmHwmMb(),
      cgroupPeakMb: cgroupPeakMb(),
      outMb: Math.round(statSync("/tmp/out.parquet").size / 1e5) / 10,
      memoryLimit,
      threads,
      repeat,
    }));
  } catch (error) {
    response.end(JSON.stringify({ ok: false, error: String(error), ms: Date.now() - started }));
  }
}).listen(8080);
