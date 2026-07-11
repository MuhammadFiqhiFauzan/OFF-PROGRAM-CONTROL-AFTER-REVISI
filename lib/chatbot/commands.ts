/*
 * Tujuan: Data query commands untuk chatbot — query DB berdasarkan natural language sederhana.
 * Caller: app/api/chatbot/route.ts.
 * Dependensi: db.ts, schema.ts, drizzle-orm.
 * ponytail: regex pattern → direct Drizzle query. No NLP, no parser lib.
 */
import { db } from "@/lib/db";
import { count, sum, like, desc, eq, and, sql } from "drizzle-orm";
import { offBatch, claimWorkflow, offPayment, user } from "@/db/schema";
import type { BotResponse } from "./types";

type CommandHandler = () => Promise<BotResponse>;

const BULAN_MAP: Record<string, string> = {
  januari: "1", februari: "2", maret: "3", april: "4", mei: "5", juni: "6",
  juli: "7", agustus: "8", september: "9", oktober: "10", november: "11", desember: "12",
  jan: "1", feb: "2", mar: "3", apr: "4", jun: "6", jul: "7", agu: "8", sep: "9", okt: "10", nov: "11", des: "12",
};

function parseBulan(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return BULAN_MAP[lower] ?? lower;
}

function fmtRp(val: number): string {
  return `Rp ${val.toLocaleString("id-ID")}`;
}

function sanitizeLike(raw: string): string {
  return raw.replace(/[%_]/g, "").slice(0, 50);
}

function statusIcon(s: string): string {
  const lower = (s ?? "").toLowerCase();
  if (lower === "not started" || lower === "not applicable") return "\u23f3";
  if (lower.includes("approved") || lower.includes("completed") || lower.includes("paid") || lower === "lunas") return "\u2705";
  if (lower.includes("returned") || lower.includes("cancel") || lower.includes("reject")) return "\u274c";
  return "\u23f3";
}

// ─── Task 1: Status Lookup by ID ───

async function batchStatusById(term: string): Promise<BotResponse> {
  const safe = sanitizeLike(term);
  const rows = await db.select().from(offBatch)
    .where(like(offBatch.noPengajuan, `%${safe}%`))
    .orderBy(desc(offBatch.createdAt))
    .limit(5);

  if (!rows.length) return { text: `Batch dengan nomor pengajuan "${safe}" tidak ditemukan.` };

  let prefix = "";
  if (rows.length > 1) prefix = `Ditemukan ${rows.length} batch, menampilkan hasil terbaru:\n\n`;

  const blocks = rows.map((b) => {
    const lines = [
      `**Batch: ${b.noPengajuan}**`,
      `Principal: ${b.principleName}`,
      `Periode: ${b.bulan}/${b.tahun}`,
      `Supervisor: ${b.supervisorName}`,
      `Nominal: ${fmtRp(b.totalNominal)}`,
      "",
      "**Status Workflow:**",
      `- Supervisor: ${b.status} ${statusIcon(b.status)}`,
      `- Sales Manager: ${b.smStatus} ${statusIcon(b.smStatus)}`,
      `- Claim: ${b.claimStatus} ${statusIcon(b.claimStatus)}`,
      `- OM: ${b.omStatus} ${statusIcon(b.omStatus)}`,
      `- Finance: ${b.financeStatus} ${statusIcon(b.financeStatus)}`,
      `- Final: ${b.finalStatus} ${statusIcon(b.finalStatus)}`,
      `- Refund: ${b.refundStatus} ${statusIcon(b.refundStatus)}`,
    ];
    if (b.smNote) lines.push(`Catatan SM: ${b.smNote}`);
    if (b.claimNote) lines.push(`Catatan Claim: ${b.claimNote}`);
    if (b.omNote) lines.push(`Catatan OM: ${b.omNote}`);
    if (b.financeNote) lines.push(`Catatan Finance: ${b.financeNote}`);
    return lines.join("\n");
  });

  return { text: prefix + blocks.join("\n\n---\n\n") };
}

async function claimStatusById(term: string): Promise<BotResponse> {
  const safe = sanitizeLike(term);
  const rows = await db.select().from(claimWorkflow)
    .where(like(claimWorkflow.claimWorkflowNo, `%${safe}%`))
    .orderBy(desc(claimWorkflow.createdAt))
    .limit(5);

  if (!rows.length) return { text: `Claim workflow dengan nomor "${safe}" tidak ditemukan.` };

  let prefix = "";
  if (rows.length > 1) prefix = `Ditemukan ${rows.length} claim, menampilkan hasil terbaru:\n\n`;

  const blocks = rows.map((c) => {
    const lines = [
      `**Claim: ${c.claimWorkflowNo}**`,
      `Principal: ${c.principleName}`,
      `Status: ${c.status} ${statusIcon(c.status)}`,
      c.noClaim ? `No Claim: ${c.noClaim}` : "No Claim: belum di-assign",
      "",
      "**Nilai:**",
      `- DPP: ${fmtRp(c.totalDpp)}`,
      `- PPN: ${fmtRp(c.totalPpn)}`,
      `- PPh: ${fmtRp(c.totalPph)}`,
      `- Total Klaim: ${fmtRp(c.totalClaim)}`,
      `- Sudah Dibayar: ${fmtRp(c.totalPaid)}`,
      `- Sisa: ${fmtRp(c.remainingAmount)}`,
    ];
    if (c.submittedToPrincipalAt) lines.push(`Submitted: ${new Date(c.submittedToPrincipalAt).toLocaleDateString("id-ID")}`);
    if (c.closedAt) lines.push(`Closed: ${new Date(c.closedAt).toLocaleDateString("id-ID")}`);
    return lines.join("\n");
  });

  return { text: prefix + blocks.join("\n\n---\n\n") };
}

// ─── Task 2: Enhanced Aggregate Queries ───

async function totalBatches(): Promise<BotResponse> {
  const [r] = await db.select({ c: count() }).from(offBatch);
  const rows = await db.select({ status: offBatch.status, c: count() }).from(offBatch).groupBy(offBatch.status);
  let text = `Total batch OPC: **${r?.c ?? 0}** batch.`;
  if (rows.length) {
    text += "\n\nPer status:\n" + rows.map((r) => `- ${r.status ?? "N/A"}: **${r.c}**`).join("\n");
  }
  return { text };
}

async function totalClaims(): Promise<BotResponse> {
  const [r] = await db.select({ c: count() }).from(claimWorkflow);
  const rows = await db.select({ status: claimWorkflow.status, c: count() }).from(claimWorkflow).groupBy(claimWorkflow.status);
  let text = `Total claim workflow: **${r?.c ?? 0}** klaim.`;
  if (rows.length) {
    text += "\n\nPer status:\n" + rows.map((r) => `- ${r.status ?? "N/A"}: **${r.c}**`).join("\n");
  }
  return { text };
}

async function batchByStatus(): Promise<BotResponse> {
  const rows = await db
    .select({ status: offBatch.status, c: count() })
    .from(offBatch)
    .groupBy(offBatch.status);
  if (!rows.length) return { text: "Belum ada batch OPC." };
  const lines = rows.map((r) => `- ${r.status ?? "N/A"}: **${r.c}**`);
  return { text: "Jumlah batch per status:\n" + lines.join("\n") };
}

async function totalPayments(): Promise<BotResponse> {
  const [totalRow] = await db.select({ total: sum(offPayment.paidAmount), c: count() }).from(offPayment);
  const val = Number(totalRow?.total ?? 0);
  const cnt = totalRow?.c ?? 0;
  return {
    text: `Total pembayaran OPC: **${fmtRp(val)}**\n- **${cnt}** transaksi pembayaran`,
  };
}

async function claimByStatus(): Promise<BotResponse> {
  const rows = await db
    .select({ status: claimWorkflow.status, c: count() })
    .from(claimWorkflow)
    .groupBy(claimWorkflow.status);
  if (!rows.length) return { text: "Belum ada claim workflow." };
  const lines = rows.map((r) => `- ${r.status ?? "N/A"}: **${r.c}**`);
  return { text: "Jumlah claim per status:\n" + lines.join("\n") };
}

async function totalUsers(): Promise<BotResponse> {
  const [r] = await db.select({ c: count() }).from(user);
  const roles = await db.select({ role: user.role, c: count() }).from(user).groupBy(user.role);
  let text = `Total user terdaftar: **${r?.c ?? 0}**`;
  if (roles.length) {
    text += "\n\nPer role:\n" + roles.map((r) => `- ${r.role ?? "N/A"}: **${r.c}**`).join("\n");
  }
  return { text };
}

async function paymentCount(): Promise<BotResponse> {
  const [r] = await db.select({ c: count() }).from(offPayment);
  return { text: `Total record pembayaran OPC: **${r?.c ?? 0}** transaksi.` };
}

// ─── Task 3: Search by Principal / Periode ───

async function batchByPrincipal(name: string): Promise<BotResponse> {
  const safe = sanitizeLike(name);
  const rows = await db.select().from(offBatch)
    .where(like(offBatch.principleName, `%${safe}%`))
    .orderBy(desc(offBatch.createdAt))
    .limit(10);

  if (!rows.length) return { text: `Tidak ditemukan batch untuk principal "${safe}".` };

  const lines = rows.map((b, i) =>
    `${i + 1}. ${b.noPengajuan} \u2014 ${b.bulan}/${b.tahun} \u2014 ${b.status} \u2014 ${fmtRp(b.totalNominal)}`
  );
  return {
    text: `Batch principal "${name}": ditemukan **${rows.length}** batch.\n\n${lines.join("\n")}\n\nKetik "status batch [nomor]" untuk detail lengkap.`,
  };
}

async function batchByPeriode(bulanRaw: string, tahunRaw?: string): Promise<BotResponse> {
  const bulan = parseBulan(bulanRaw);
  const tahun = tahunRaw?.trim();

  const conditions = [eq(offBatch.bulan, bulan)];
  if (tahun) conditions.push(eq(offBatch.tahun, tahun));

  const rows = await db.select().from(offBatch)
    .where(and(...conditions))
    .orderBy(desc(offBatch.createdAt))
    .limit(10);

  if (!rows.length) return { text: `Tidak ditemukan batch untuk periode ${bulanRaw}${tahun ? "/" + tahun : ""}.` };

  const label = tahun ? `${bulanRaw}/${tahun}` : bulanRaw;
  const lines = rows.map((b, i) =>
    `${i + 1}. ${b.noPengajuan} \u2014 ${b.principleName} \u2014 ${b.status} \u2014 ${fmtRp(b.totalNominal)}`
  );
  return {
    text: `Batch periode ${label}: ditemukan **${rows.length}** batch.\n\n${lines.join("\n")}\n\nKetik "status batch [nomor]" untuk detail lengkap.`,
  };
}

async function claimByPrincipal(name: string): Promise<BotResponse> {
  const safe = sanitizeLike(name);
  const rows = await db.select().from(claimWorkflow)
    .where(like(claimWorkflow.principleName, `%${safe}%`))
    .orderBy(desc(claimWorkflow.createdAt))
    .limit(10);

  if (!rows.length) return { text: `Tidak ditemukan claim untuk principal "${safe}".` };

  const lines = rows.map((c, i) =>
    `${i + 1}. ${c.claimWorkflowNo} \u2014 ${c.status} \u2014 ${fmtRp(c.totalClaim)}`
  );
  return {
    text: `Claim principal "${name}": ditemukan **${rows.length}** klaim.\n\n${lines.join("\n")}\n\nKetik "status claim [nomor]" untuk detail lengkap.`,
  };
}

// ─── Command Routing ───

// Parameterized commands need input, handled separately in tryCommand
const PARAM_COMMANDS: { pattern: RegExp; handler: (match: RegExpMatchArray) => Promise<BotResponse>; desc: string }[] = [
  // Status by ID (most specific — must come first)
  // Require arg to be alphanumeric ID (not FAQ keywords like "cek", "cari")
  { pattern: /(?:status|detail|cek|lacak)\s*batch\s+([a-zA-Z0-9][a-zA-Z0-9\-_ ]*)/i, handler: (m) => batchStatusById(m[1].trim()), desc: "status batch [nomor]" },
  { pattern: /(?:status|detail|cek|lacak)\s*claim\s+([a-zA-Z0-9][a-zA-Z0-9\-_ ]*)/i, handler: (m) => claimStatusById(m[1].trim()), desc: "status claim [nomor]" },

  // Search by principal
  { pattern: /batch\s*(?:principal|principle)\s+([a-zA-Z][a-zA-Z0-9 ]+)/i, handler: (m) => batchByPrincipal(m[1].trim()), desc: "batch principal [nama]" },
  { pattern: /(?:principal|principle)\s+([a-zA-Z][a-zA-Z0-9 ]+?)\s*batch/i, handler: (m) => batchByPrincipal(m[1].trim()), desc: "batch principal [nama]" },
  { pattern: /claim\s*(?:principal|principle)\s+([a-zA-Z][a-zA-Z0-9 ]+)/i, handler: (m) => claimByPrincipal(m[1].trim()), desc: "claim principal [nama]" },
  { pattern: /(?:principal|principle)\s+([a-zA-Z][a-zA-Z0-9 ]+?)\s*claim/i, handler: (m) => claimByPrincipal(m[1].trim()), desc: "claim principal [nama]" },

  // Search by periode
  { pattern: /batch\s*(?:bulan|periode)\s+(\w+)\s*(\d{4})?/i, handler: (m) => batchByPeriode(m[1], m[2]), desc: "batch bulan [bulan] [tahun]" },
  { pattern: /(?:bulan|periode)\s+(\w+)\s*(\d{4})?\s*batch/i, handler: (m) => batchByPeriode(m[1], m[2]), desc: "batch bulan [bulan] [tahun]" },
];

const SIMPLE_COMMANDS: { patterns: RegExp[]; handler: CommandHandler; desc: string }[] = [
  { patterns: [/total batch/i, /berapa batch/i, /jumlah batch/i], handler: totalBatches, desc: "total batch OPC + status breakdown" },
  { patterns: [/total klaim/i, /berapa klaim/i, /jumlah claim/i, /total claim/i], handler: totalClaims, desc: "total klaim + status breakdown" },
  { patterns: [/batch.*status/i, /status.*batch/i], handler: batchByStatus, desc: "batch per status" },
  { patterns: [/claim.*status/i, /status.*claim/i], handler: claimByStatus, desc: "claim per status" },
  { patterns: [/total bayar/i, /total payment/i, /berapa bayar/i, /jumlah bayar/i], handler: totalPayments, desc: "total pembayaran + breakdown" },
  { patterns: [/total user/i, /berapa user/i, /jumlah user/i, /total akun/i], handler: totalUsers, desc: "total user" },
  { patterns: [/total transaksi/i, /jumlah transaksi/i, /berapa transaksi/i], handler: paymentCount, desc: "total transaksi pembayaran" },
];

export function getCommandHelp(): string {
  const lines = SIMPLE_COMMANDS.map((c) => `- "${c.desc}"`);
  const paramLines = PARAM_COMMANDS
    .filter((c, i, arr) => arr.findIndex((x) => x.desc === c.desc) === i)
    .map((c) => `- "${c.desc}"`);
  return "Perintah data yang tersedia:\n" + [...lines, ...paramLines].join("\n");
}

export async function tryCommand(input: string): Promise<BotResponse | null> {
  for (const cmd of PARAM_COMMANDS) {
    const match = input.match(cmd.pattern);
    if (match) {
      try {
        return await cmd.handler(match);
      } catch {
        return { text: "Gagal mengambil data. Coba lagi nanti." };
      }
    }
  }

  for (const cmd of SIMPLE_COMMANDS) {
    if (cmd.patterns.some((p) => p.test(input))) {
      try {
        return await cmd.handler();
      } catch {
        return { text: "Gagal mengambil data. Coba lagi nanti." };
      }
    }
  }
  return null;
}
