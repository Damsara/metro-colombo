const SHELL = "https://shell.duckdb.org/";

const SWAP: Record<string, string> = { " ": "-", "-": " ", ";": "~", "~": ";" };

// The shell's share format swaps these pairs before percent-encoding, so a space reads as "-" in the link.
const encodeQuery = (sql: string) =>
  encodeURIComponent(
    sql
      .trim()
      .replace(/;$/, "")
      .replace(/\s+/g, " ")
      .replace(/[ \-;~]/g, (c) => SWAP[c]),
  );

export function duckdbShellLink(queries: readonly string[]): string {
  return `${SHELL}#queries=v0,${queries.map((q) => `${encodeQuery(q)}~`).join(",")}`;
}
