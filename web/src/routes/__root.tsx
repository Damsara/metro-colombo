import { Trans } from "@lingui/react/macro";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { DOCS_MAIN, DOCS_TITLE, HEADER_LINK } from "../classNames";

export const Route = createRootRoute({
  component: Outlet,
  notFoundComponent: NotFound,
});

function NotFound() {
  return (
    <main className={DOCS_MAIN}>
      <h1 className={DOCS_TITLE}>
        <Trans>Page not found :c</Trans>
      </h1>
      <p>
        <Link className={HEADER_LINK} to="/">
          <Trans>Back to the map</Trans>
        </Link>
      </p>
    </main>
  );
}
