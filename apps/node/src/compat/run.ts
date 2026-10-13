import {
  type Captured,
  compare,
  type Difference,
  type Probe,
} from "./compare.js";

export type Capture = (probe: Probe) => Promise<Captured>;

export const captureWithRetry = async (
  capture: Capture,
  probe: Probe,
): Promise<Captured> => {
  try {
    return await capture(probe);
  } catch {
    return await capture(probe);
  }
};

const failure = (error: unknown) =>
  `fetch failed (${error instanceof Error ? error.name : "unknown error"})`;

const settle = async (
  capture: Capture,
  probe: Probe,
): Promise<{ captured: Captured } | { error: string }> => {
  try {
    return { captured: await captureWithRetry(capture, probe) };
  } catch (error) {
    return { error: failure(error) };
  }
};

export type RunResult = {
  readonly differences: Difference[];
  readonly unreachable: number;
};

const once = async (
  base: Capture,
  candidate: Capture,
  probe: Probe,
): Promise<{ found: Difference[] } | { unreachable: Difference }> => {
  const [a, b] = await Promise.all([
    settle(base, probe),
    settle(candidate, probe),
  ]);
  if ("error" in a || "error" in b)
    return {
      unreachable: {
        probe: probe.name,
        what: "fetch failed",
        base: "error" in a ? a.error : "ok",
        candidate: "error" in b ? b.error : "ok",
      },
    };
  return { found: compare(probe, a.captured, b.captured) };
};

export const runProbes = async (
  list: ReadonlyArray<Probe>,
  base: Capture,
  candidate: Capture,
): Promise<RunResult> => {
  const differences: Difference[] = [];
  let unreachable = 0;
  for (const probe of list) {
    let result = await once(base, candidate, probe);
    if (
      "found" in result &&
      result.found.length > 0 &&
      probe.body === "journey"
    )
      result = await once(base, candidate, probe);
    if ("unreachable" in result) {
      unreachable++;
      differences.push(result.unreachable);
    } else differences.push(...result.found);
  }
  return { differences, unreachable };
};

export const exitCode = (result: RunResult) =>
  result.unreachable > 0 ? 2 : result.differences.length > 0 ? 1 : 0;
