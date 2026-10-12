import { Effect } from "effect";
import { HttpClient } from "effect/http";
import { fakeHttpClient } from "@metro/core/testing";

export const fakeLankaMetro = (log: string[] = []) => {
  const calls = { refresh: [] as string[], webview: 0, checkPhone: [] as string[], verify: 0, routes: 0 };
  const settings = { refreshStatus: 200, webviewStatus: 200, refreshHangs: false, verifyHangs: false };
  let issued = 0;
  const http = fakeHttpClient((request) => {
    const path = request.url.pathname;
    const body = (request.text ? JSON.parse(request.text) : {}) as Record<string, string>;
    log.push(`call ${path.split("/auth/")[1] ?? path}`);
    if (path.endsWith("/auth/refresh")) {
      calls.refresh.push(body.refresh_token);
      if (settings.refreshStatus !== 200) {
        return { status: settings.refreshStatus, json: { error: { code: "INVALID_REFRESH_TOKEN" } } };
      }
      issued += 1;
      return { status: 200, json: { data: { access_token: `access-${issued}`, refresh_token: `refresh-${issued}` } } };
    }
    if (path.endsWith("/auth/webview-token")) {
      calls.webview += 1;
      return settings.webviewStatus === 200
        ? { status: 200, json: { data: { webview_token: `webview-${calls.webview}`, expires_in: 3600 } } }
        : { status: settings.webviewStatus, json: {} };
    }
    if (path.endsWith("/auth/customer/check-phone")) {
      calls.checkPhone.push(body.phone);
      return { status: 200, json: { data: { otp_reference: `ref-${calls.checkPhone.length}`, has_account: true } } };
    }
    if (path.endsWith("/auth/customer/verify-otp")) {
      calls.verify += 1;
      return body.otp_code === "123456" && body.otp_reference === `ref-${calls.checkPhone.length}`
        ? { status: 200, json: { data: { tokens: { access_token: "access-otp", refresh_token: "refresh-otp" } } } }
        : { status: 400, json: { error: { code: "INVALID_OTP" } } };
    }
    if (path.endsWith("/fare-service/api/v1/routes/geo")) {
      calls.routes += 1;
      return { status: 200, json: { data: { routes: [{ id: "route-1", code: "138" }] } } };
    }
    return { status: 404, json: {} };
  });
  // A hung refresh reaches upstream, which rotates the token, but the reply never arrives.
  const client = http.client.pipe(
    HttpClient.transform((response, request) =>
      (settings.refreshHangs && request.url.endsWith("/auth/refresh")) ||
      (settings.verifyHangs && request.url.endsWith("/auth/customer/verify-otp"))
        ? Effect.andThen(response, Effect.never)
        : response,
    ),
  );
  return { client, requests: http.requests, calls, settings };
};
