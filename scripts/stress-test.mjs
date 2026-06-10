/**
 * stress-test.mjs
 * Login ke BASE_URL lalu stress test /api/off-program-control/batches
 * Usage: node scripts/stress-test.mjs [concurrency] [rounds]
 */

const BASE = process.env.BASE_URL || process.env.SEED_BASE_URL || "http://localhost:3000";
const EMAIL = process.env.STRESS_EMAIL || "admin@admin.com";
const PASSWORD = process.env.STRESS_PASSWORD || "Admin#2026";
const CONCURRENCY = parseInt(process.argv[2] || "10");
const ROUNDS = parseInt(process.argv[3] || "3");

// ── 1. LOGIN ──────────────────────────────────────────────────────────────────
process.stdout.write("🔐 Logging in... ");
const loginRes = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Origin": BASE,
    "Referer": `${BASE}/login`,
  },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});

if (!loginRes.ok) {
  console.error("FAILED", loginRes.status, await loginRes.text());
  process.exit(1);
}

// Extract session cookie
const setCookie = loginRes.headers.get("set-cookie") || "";
const sessionCookie = setCookie.split(";")[0]; // grab first cookie
console.log("OK ✅");
console.log("Cookie:", sessionCookie.substring(0, 60) + "...");

// ── 2. STRESS TEST ────────────────────────────────────────────────────────────
const ENDPOINTS = [
  "/api/off-program-control/batches",
];

async function hit(url) {
  const t0 = performance.now();
  const res = await fetch(`${BASE}${url}`, {
    headers: { Cookie: sessionCookie },
  });
  const ms = Math.round(performance.now() - t0);
  const data = await res.json().catch(() => ({}));
  return { url, status: res.status, ms, ok: data.ok, count: data.batches?.length };
}

async function runRound(round) {
  console.log(`\n⚡ Round ${round} — ${CONCURRENCY} concurrent requests`);
  const tasks = Array.from({ length: CONCURRENCY }, () => hit(ENDPOINTS[0]));
  const results = await Promise.all(tasks);
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  const avg = Math.round(times.reduce((s, t) => s + t, 0) / times.length);
  const p50 = times[Math.floor(times.length * 0.5)];
  const p95 = times[Math.floor(times.length * 0.95)];
  const errors = results.filter((r) => !r.ok || r.status !== 200).length;

  console.log(`  Min: ${times[0]}ms  Avg: ${avg}ms  P50: ${p50}ms  P95: ${p95}ms  Max: ${times[times.length - 1]}ms`);
  console.log(`  OK: ${results.length - errors}/${results.length}  Errors: ${errors}`);
  if (errors > 0) {
    results.filter((r) => !r.ok).forEach((r) => console.log("  ❌", r.status, r.url));
  }
  return { avg, p50, p95, min: times[0], max: times[times.length - 1], errors };
}

// Warm-up
process.stdout.write("\n🔥 Warm-up... ");
const warmup = await hit(ENDPOINTS[0]);
console.log(`${warmup.ms}ms (${warmup.count} batches)`);

// Rounds
const allRounds = [];
for (let r = 1; r <= ROUNDS; r++) {
  const result = await runRound(r);
  allRounds.push(result);
  if (r < ROUNDS) await new Promise((res) => setTimeout(res, 500));
}

// Summary
console.log("\n📊 Summary");
const avgAll = Math.round(allRounds.reduce((s, r) => s + r.avg, 0) / allRounds.length);
const p95All = Math.round(allRounds.reduce((s, r) => s + r.p95, 0) / allRounds.length);
console.log(`  Avg response: ${avgAll}ms  P95: ${p95All}ms  Total requests: ${CONCURRENCY * ROUNDS}`);
console.log(`  Total errors: ${allRounds.reduce((s, r) => s + r.errors, 0)}`);
