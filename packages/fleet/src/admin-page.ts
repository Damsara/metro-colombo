// The secret is typed into the page, never served by it, so the page itself is safe to show anyone.
export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Fleet login</title>
<style>
  :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
  body { margin: 0 auto; max-width: 28rem; padding: 1.5rem 1rem; line-height: 1.4; }
  h1 { font-size: 1.25rem; margin: 0 0 1rem; }
  section { border: 1px solid #8884; border-radius: 0.5rem; padding: 1rem; margin-bottom: 1rem; }
  h2 { font-size: 1rem; margin: 0 0 0.5rem; }
  label { display: block; font-size: 0.875rem; margin-bottom: 0.25rem; }
  input[type=password], input[type=tel], input[type=text] {
    box-sizing: border-box; width: 100%; font: inherit; padding: 0.5rem; margin-bottom: 0.5rem;
  }
  button { font: inherit; padding: 0.5rem 1rem; }
  output { display: block; margin-top: 0.5rem; font-size: 0.875rem; white-space: pre-wrap; }
  .row { display: flex; gap: 0.5rem; align-items: center; font-size: 0.875rem; }
</style>
</head>
<body>
<h1>Fleet login</h1>
<section>
  <label for="secret">OTP secret</label>
  <input id="secret" type="password" autocomplete="off">
  <label class="row"><input id="remember" type="checkbox"> Remember on this device</label>
</section>
<section>
  <h2>Status</h2>
  <button id="status-button" type="button">Check</button>
  <output id="status-out"></output>
</section>
<section>
  <h2>Send a code</h2>
  <label for="phone">LMT-GO phone number</label>
  <input id="phone" type="tel" inputmode="tel" placeholder="077 123 4567" autocomplete="off">
  <button id="login-button" type="button">Send code</button>
  <output id="login-out"></output>
</section>
<section>
  <h2>Enter the code</h2>
  <label for="code">Six-digit code from the SMS</label>
  <input id="code" type="text" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
  <button id="code-button" type="button">Log in</button>
  <output id="code-out"></output>
</section>
<script src="/fleet/admin.js"></script>
</body>
</html>
`;

export const ADMIN_SCRIPT = `"use strict";
const KEY = "fleet-otp-secret";
const $ = (id) => document.getElementById(id);
const secret = $("secret");
const remember = $("remember");
const saved = localStorage.getItem(KEY);
if (saved) { secret.value = saved; remember.checked = true; }
const keep = () => {
  if (remember.checked && secret.value) localStorage.setItem(KEY, secret.value);
  else localStorage.removeItem(KEY);
};
remember.addEventListener("change", keep);
secret.addEventListener("change", keep);

const call = async (method, path, body) => {
  const response = await fetch(path, {
    method,
    headers: {
      authorization: "Bearer " + secret.value,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { status: response.status, data };
};

const run = (buttonId, outId, action) => {
  const button = $(buttonId);
  const out = $(outId);
  button.addEventListener("click", async () => {
    if (!secret.value) { out.textContent = "Enter the OTP secret first."; return; }
    button.disabled = true;
    out.textContent = "…";
    try { out.textContent = await action(); }
    catch { out.textContent = "The server didn't answer."; }
    finally { button.disabled = false; }
  });
};

const wrongSecret = "Wrong secret, or the server has no OTP_SECRET.";

run("status-button", "status-out", async () => {
  const { status, data } = await call("GET", "/fleet/status");
  if (status === 404) return wrongSecret;
  const age = data.age_ms === null ? "none yet" : Math.round(data.age_ms / 1000) + " s old";
  return "Login: " + data.login + "\\nFeed: " + data.feed + "\\nPositions: " + age;
});

run("login-button", "login-out", async () => {
  const { status, data } = await call("POST", "/fleet/login", { phone: $("phone").value });
  switch (status) {
    case 202: return "Code sent. Enter it below.";
    case 404: return wrongSecret;
    case 429: return "A code went out moments ago. Try again in " + data.retry_after_s + " s.";
    default: return data.error || "Failed (HTTP " + status + ").";
  }
});

run("code-button", "code-out", async () => {
  const { status, data } = await call("POST", "/fleet/otp", { code: $("code").value });
  switch (status) {
    case 200: return "Logged in. The live feed is resuming.";
    case 404: return wrongSecret;
    case 409: return "No code is pending. Send a code first.";
    default: return data.error || "Failed (HTTP " + status + ").";
  }
});
`;
