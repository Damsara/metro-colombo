import { useEffect, useMemo, useRef, useState } from "react";
import * as vg from "@uwdata/vgplot";
import {
  CROWDING_SQL,
  HOURLY_SQL,
  chartViews,
  routeScale,
} from "../lib/archiveCharts";
import { useRoutes } from "../api";
import { duckdbShellLink } from "../lib/duckdbShell";
import { HEADER_LINK } from "../classNames";
import { palette } from "../theme";

type Status = "loading" | "ready" | "failed";

function ShellLink({ setup, sql }: { setup: string[]; sql: string }) {
  return (
    <a
      className={HEADER_LINK}
      href={duckdbShellLink([...setup, sql])}
      target="_blank"
      rel="noreferrer"
    >
      Run in the DuckDB shell
    </a>
  );
}

export default function ArchiveCharts({
  catalogUrl,
  shellSetup,
}: {
  catalogUrl: string;
  shellSetup: string[];
}) {
  const picker = useRef<HTMLDivElement>(null);
  const hourly = useRef<HTMLDivElement>(null);
  const crowding = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<Status>("loading");
  const routes = useRoutes();
  const settled = !routes.isPending;
  const routeList = routes.data;
  const scale = useMemo(() => routeScale(routeList ?? []), [routeList]);

  useEffect(() => {
    const slots = [picker.current, hourly.current, crowding.current];
    if (!settled || slots.some((slot) => !slot)) return;
    let cancelled = false;
    const coordinator = new vg.Coordinator(vg.wasmConnector(), {
      logger: null,
    });
    const api = vg.createAPIContext({ coordinator });

    (async () => {
      await coordinator.exec(chartViews(catalogUrl));
      if (cancelled) return;
      const { domain, range } = scale;
      const route = api.Selection.single();
      const width = Math.max(280, (hourly.current?.clientWidth ?? 640) - 8);
      picker.current!.replaceChildren(
        api.menu({
          label: "Route",
          as: route,
          from: "hourly",
          column: "route_code",
        }),
      );
      hourly.current!.replaceChildren(
        api.plot(
          api.lineY(api.from("hourly", { filterBy: route }), {
            x: "hour",
            y: "moving_buses",
            stroke: "route_code",
            z: "route_code",
            curve: "step-after",
          }),
          api.colorDomain(domain),
          api.colorRange(range),
          api.width(width),
          api.height(240),
          api.xLabel(null),
          api.yLabel("Buses moving"),
          api.yGrid(true),
          api.yTickFormat((n: number) =>
            Number.isInteger(n) ? String(n) : "",
          ),
        ),
      );
      crowding.current!.replaceChildren(
        api.plot(
          api.cell(api.from("crowding", { filterBy: route }), {
            x: "hour",
            y: "route_code",
            fill: "avg_load",
            inset: 0.5,
          }),
          api.colorScale("linear"),
          api.colorDomain([0, 1]),
          api.colorRange([palette.card, palette.brand]),
          api.width(width),
          api.height(60 + domain.length * 26),
          api.xLabel("Hour of day"),
          api.yLabel(null),
        ),
      );
      setStatus("ready");
    })().catch(() => {
      if (!cancelled) setStatus("failed");
    });

    return () => {
      cancelled = true;
      slots.forEach((slot) => slot?.replaceChildren());
      coordinator.clear();
    };
  }, [catalogUrl, settled, scale]);

  return (
    <div>
      {status === "loading" && (
        <p role="status">Starting DuckDB in your browser…</p>
      )}
      {status === "failed" && (
        <p role="status">
          The charts couldn't load here. The queries below still work in the
          DuckDB shell.
        </p>
      )}
      <div
        ref={picker}
        className="mb-3 text-sm [&_select]:ml-2 [&_select]:rounded-md [&_select]:border [&_select]:border-line [&_select]:bg-card [&_select]:px-2 [&_select]:py-1"
      />
      <h3 className="mt-4 mb-1.5 text-md font-semibold">
        Buses on the road, by hour
      </h3>
      <p>
        Buses that moved more than 200 m in the hour, so parked ones don't
        count.
      </p>
      <ul className="mb-2 flex flex-wrap gap-x-4 gap-y-1 pl-0! text-sm">
        {scale.domain.map((code, index) => (
          <li key={code} className="mt-0! flex list-none items-center gap-1.5">
            <span
              className="inline-block h-0.5 w-4"
              style={{ backgroundColor: scale.range[index] }}
              aria-hidden="true"
            />
            {code}
          </li>
        ))}
      </ul>
      <div ref={hourly} className="overflow-x-auto" />
      <p>
        <ShellLink setup={shellSetup} sql={HOURLY_SQL} />
      </p>
      <h3 className="mt-6 mb-1.5 text-md font-semibold">
        How full each route gets
      </h3>
      <p>Average load by hour of day across the whole archive.</p>
      <div className="mb-2 flex items-center gap-2 text-sm text-muted">
        Empty
        <span
          className="inline-block h-2.5 w-24 rounded-sm"
          style={{
            backgroundImage: `linear-gradient(to right, ${palette.card}, ${palette.brand})`,
          }}
          aria-hidden="true"
        />
        Full
      </div>
      <div ref={crowding} className="overflow-x-auto" />
      <p>
        <ShellLink setup={shellSetup} sql={CROWDING_SQL} />
      </p>
    </div>
  );
}
