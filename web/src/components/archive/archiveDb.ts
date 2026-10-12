import * as vg from "@uwdata/vgplot";
import { setupStatements } from "../../lib/archiveCharts";

export type ArchiveDb = {
  coordinator: InstanceType<typeof vg.Coordinator>;
  api: ReturnType<typeof vg.createAPIContext>;
};

const opened = new Map<string, Promise<ArchiveDb>>();

// One DuckDB per page: starting it takes seconds, and every chart reads the same catalog.
export function openArchive(catalogUrl: string): Promise<ArchiveDb> {
  let db = opened.get(catalogUrl);
  if (!db) {
    db = (async () => {
      const coordinator = new vg.Coordinator(vg.wasmConnector(), {
        logger: null,
      });
      await coordinator.exec(setupStatements(catalogUrl));
      return { coordinator, api: vg.createAPIContext({ coordinator }) };
    })();
    db.catch(() => opened.delete(catalogUrl));
    opened.set(catalogUrl, db);
  }
  return db;
}

export async function rows<T>(db: ArchiveDb, sql: string): Promise<T[]> {
  const table = await db.coordinator.query(sql);
  return table.toArray() as T[];
}

export type ResultTable = {
  fields: { name: string; typeId: number }[];
  rows: Record<string, unknown>[];
};

export async function resultTable(
  db: ArchiveDb,
  sql: string,
): Promise<ResultTable> {
  const table = await db.coordinator.query(sql);
  return {
    fields: table.schema.fields.map((field) => ({
      name: field.name,
      typeId: field.type.typeId,
    })),
    rows: table.toArray() as Record<string, unknown>[],
  };
}
