/**
 * Tujuan : Insert ~51 dummy batch per principal ke SQLite untuk testing OFF Program Control.
 * Caller : node scripts/seed-opc-dummy.mjs [--force]
 * Deps   : @libsql/client (sudah tersedia di project)
 * Output : off_batch, off_batch_item, off_payment, off_refund, off_period_closure, off_audit_log
 */

import { createClient } from "@libsql/client";
import { randomUUID } from "node:crypto";

// ─── Config ──────────────────────────────────────────────────────────────────

const DB_URL = process.env.DATABASE_URL || "file:sqlite.db";
const FORCE  = process.argv.includes("--force");
const NOW    = Math.floor(Date.now() / 1000); // Unix epoch seconds

// ─── Time Helpers ─────────────────────────────────────────────────────────────

const ago = (days) => (days != null ? NOW - Math.round(days) * 86400 : null);
const fwd = (days) => (days != null ? NOW + Math.round(days) * 86400 : null);
const iso = (sec)  => (sec  != null ? new Date(sec * 1000).toISOString().slice(0, 10) : null);

// ─── Master Data ──────────────────────────────────────────────────────────────

const PRINCIPLES = [
  { name: "RECKITT BENCKISER, PT",              code: "RB"       },
  { name: "FKS FOOD SEJAHTERA, PT",              code: "FKS"      },
  { name: "FONTERRA BRANDS INDONESIA, PT",       code: "FON"      },
  { name: "GUMINDO BOGAMANIS, PT",               code: "REBO"     },
  { name: "MARKETAMA INDAH, PT",                 code: "MI"       },
  { name: "PRIMARASA ABADI SEJAHTERA, PT",       code: "PAS"      },
  { name: "SUN PAPER SOURCE, PT",                code: "SPS"      },
  { name: "GODREJ DISTRIBUSI INDONESIA, PT",     code: "GDI"      },
  { name: "DOLPHIN, PT",                         code: "DOLPHIN"  },
  { name: "UNIVERSAL INDOFOOD PRODUCT, PT",      code: "UNIBIS"   },
  { name: "URC INDONESIA, PT",                   code: "URC"      },
  { name: "HEINZ ABC INDONESIA, PT",             code: "HEINZ"    },
  { name: "ENERGIZER INDONESIA, PT",             code: "ENI"      },
  { name: "GONDOWANGI TRADISIONAL KOSMETIK, PT", code: "NATUR"    },
  { name: "MUSTIKA RATUBUANA INTERNATIONAL",     code: "MR"       },
  { name: "PRISKILA PRIMA MAKMUR, PT",           code: "PRISKILA" },
  { name: "UNITAMA SARI MAS, PT",                code: "USM"      },
  { name: "VINDA INTERNATIONAL INDONESIA, PT",   code: "VINDA"    },
  { name: "KINO INDONESIA. TBK, PT",             code: "KINO"     },
  { name: "ABC PRESIDENT INDONESIA, PT",         code: "ABC"      },
  { name: "PZ CUSSONS INDONESIA, PT",            code: "CUSSONS"  },
  { name: "FOKUS RITEL NUSAPRIMA, PT",           code: "SHINZUI"  },
  { name: "FORISA NUSAPERSADA, PT",              code: "FRS"      },
  { name: "MOTASA INDONESIA, PT",                code: "MOTASA"   },
  { name: "PURATOS, PT",                         code: "PURATOS"  },
];

// 17 bulan: Januari 2025 – Mei 2026
const MONTHS = [
  { b: "01", y: "2025" }, { b: "02", y: "2025" }, { b: "03", y: "2025" },
  { b: "04", y: "2025" }, { b: "05", y: "2025" }, { b: "06", y: "2025" },
  { b: "07", y: "2025" }, { b: "08", y: "2025" }, { b: "09", y: "2025" },
  { b: "10", y: "2025" }, { b: "11", y: "2025" }, { b: "12", y: "2025" },
  { b: "01", y: "2026" }, { b: "02", y: "2026" }, { b: "03", y: "2026" },
  { b: "04", y: "2026" }, { b: "05", y: "2026" },
];

const PROG_TYPES  = ["Display", "Visibility", "Promo On Store", "Event", "Sample"];
const CARA_BAYAR  = ["Transfer", "Transfer", "Transfer", "Transfer", "Tunai"]; // 80% Transfer

const STORES = [
  "Alfamart Sudirman", "Indomaret Gatot Subroto", "Hypermart Semanggi",
  "Giant Kebayoran Baru", "Carrefour Lebak Bulus", "Hero Pondok Indah",
  "Superindo Kemang", "Transmart Cempaka Putih", "Lottemart Fatmawati",
  "Ranch Market Dharmawangsa", "Diamond Menteng", "Farmers Market SCBD",
  "Spar Cilandak", "Indogrosir Cililitan", "Makro BSD City",
  "Alfamart Mampang Prapatan", "Indomaret Kuningan", "Hypermart Kalibata",
  "Giant Cibubur Junction", "Carrefour Cilandak Town Square",
];

const PRODUCTS = [
  "Produk A Ukuran 1L", "Produk B Pack Isi 6", "Produk C Reguler",
  "Produk D Premium", "Produk E Economy Pack", "Produk F Botol 500ml",
  "Produk G Sachet 50gr", "Produk H Kaleng 400gr", "Produk I Refill Pack",
  "Produk J Travel Size", "Produk K Family Pack", "Produk L Trial Size",
  "Produk M Special Edition", "Produk N Bundle Pack", "Produk O Combo Set",
];

const NOMINALS = [
  1_500_000, 2_000_000, 2_500_000, 3_000_000, 3_500_000, 4_000_000,
  4_500_000, 5_000_000, 6_000_000, 7_500_000, 8_000_000, 9_000_000,
  10_000_000, 12_000_000, 15_000_000,
];

// ─── Skenario (35 total, cycling untuk 51 batch per principal) ────────────────
//
// Bidang opsional bertipe timestamp diisi dalam satuan "hari lalu" (null = belum terjadi).
// berkasLengkap         : apakah dokumen penunjang sudah lengkap
// claimDeadlineDaysFromNow : negatif = deadline sudah lewat, positif = belum lewat, null = belum ada
// hasPayment / partialPayment / hasRefund / batchRefundStatus : kontrol payment/refund records

const SC = [
  // ── 0 · Draft baru (normal, 3 hari) ──────────────────────────────────────────
  { status:"Draft", smSt:"Not Started", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:3, uDays:3 },

  // ── 1 · Draft terbengkalai warning (>5 hari) ──────────────────────────────────
  { status:"Draft", smSt:"Not Started", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:10, uDays:8 },

  // ── 2 · Draft terbengkalai danger (>10 hari) ──────────────────────────────────
  { status:"Draft", smSt:"Not Started", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:16, uDays:14 },

  // ── 3 · Submitted to SM, normal (1 hari) ──────────────────────────────────────
  { status:"Submitted to SM", smSt:"Waiting Review", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:2, sDays:1, uDays:1 },

  // ── 4 · Submitted to SM · SM_LAMBAT_APPROVE warning (>2 hari) ─────────────────
  { status:"Submitted to SM", smSt:"Waiting Review", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:5, sDays:4, uDays:4 },

  // ── 5 · Submitted to SM · SM_LAMBAT_APPROVE danger (>5 hari) ──────────────────
  { status:"Submitted to SM", smSt:"Waiting Review", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:9, sDays:8, uDays:8 },

  // ── 6 · Returned by SM, normal (2 hari) ───────────────────────────────────────
  { status:"Returned by SM", smSt:"Returned", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:4, sDays:3, retDays:2, uDays:2 },

  // ── 7 · Returned by SM · SPV_LAMBAT_REVISI warning (>3 hari) ──────────────────
  { status:"Returned by SM", smSt:"Returned", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:8, sDays:7, retDays:5, uDays:5 },

  // ── 8 · Returned by SM · SPV_LAMBAT_REVISI danger (>7 hari) ──────────────────
  { status:"Returned by SM", smSt:"Returned", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:0, berkasLengkap:false, claimDL:null, cDays:13, sDays:12, retDays:10, uDays:10 },

  // ── 9 · Approved by SM, berkas LENGKAP · CLAIM_LAMBAT_APPROVE warning (SM 4 hari) ─
  { status:"Approved by SM", smSt:"Approved by SM", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:20, cDays:6, sDays:5, smDays:4, uDays:4 },

  // ── 10 · Approved by SM, berkas TIDAK LENGKAP · CLAIM_TERHAMBAT_BERKAS (SM 6 hari) ─
  { status:"Approved by SM", smSt:"Approved by SM", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:false, claimDL:14, cDays:8, sDays:7, smDays:6, uDays:6 },

  // ── 11 · Approved by SM, normal (SM 1 hari) ──────────────────────────────────
  { status:"Approved by SM", smSt:"Approved by SM", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:28, cDays:3, sDays:2, smDays:1, uDays:1 },

  // ── 12 · Claim Approved · OM_LAMBAT_KEPUTUSAN warning (claim 4 hari) ──────────
  { status:"Claim Approved", smSt:"Approved by SM", claimSt:"Approved", omSt:"Waiting Approval", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:14, cDays:8, sDays:7, smDays:6, clDays:4, uDays:4 },

  // ── 13 · Claim Approved · OM_LAMBAT_KEPUTUSAN danger (claim 7 hari) ───────────
  { status:"Claim Approved", smSt:"Approved by SM", claimSt:"Approved", omSt:"Waiting Approval", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:7, cDays:11, sDays:10, smDays:9, clDays:7, uDays:7 },

  // ── 14 · Claim Approved, normal (claim 1 hari) ───────────────────────────────
  { status:"Claim Approved", smSt:"Approved by SM", claimSt:"Approved", omSt:"Waiting Approval", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:21, cDays:4, sDays:3, smDays:2, clDays:1, uDays:1 },

  // ── 15 · OM Approved · PEMBAYARAN_TERLAMBAT danger (deadline 10 hari lalu) ─────
  { status:"OM Approved", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Waiting Payment", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:-10, cDays:25, sDays:24, smDays:22, clDays:18, omDays:14, uDays:14 },

  // ── 16 · OM Approved · PEMBAYARAN_TERLAMBAT critical (deadline 20 hari lalu) ───
  { status:"OM Approved", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Waiting Payment", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:-20, cDays:35, sDays:34, smDays:32, clDays:28, omDays:24, uDays:24 },

  // ── 17 · OM Approved, deadline 3 hari ke depan (normal) ──────────────────────
  { status:"OM Approved", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Waiting Payment", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:3, cDays:12, sDays:11, smDays:9, clDays:7, omDays:5, uDays:5 },

  // ── 18 · Partial Paid · PARSIAL_BAYAR_MACET warning (payment 8 hari) ──────────
  { status:"Partial Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Partial Paid", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:-5, cDays:22, sDays:21, smDays:19, clDays:15, omDays:11, pDays:8, uDays:8, hasPayment:true, partialPayment:true },

  // ── 19 · Partial Paid · PARSIAL_BAYAR_MACET danger (payment 12 hari) ──────────
  { status:"Partial Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Partial Paid", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:-12, cDays:28, sDays:27, smDays:25, clDays:21, omDays:17, pDays:12, uDays:12, hasPayment:true, partialPayment:true },

  // ── 20 · Partial Paid, normal (payment 2 hari) ────────────────────────────────
  { status:"Partial Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Partial Paid", finalSt:"Not Started",
    locked:1, berkasLengkap:true, claimDL:-2, cDays:14, sDays:13, smDays:11, clDays:9, omDays:7, pDays:2, uDays:2, hasPayment:true, partialPayment:true },

  // ── 21 · Paid · VERIFIKASI_FINAL_LAMBAT danger (paid 8 hari, berkas LENGKAP) ──
  { status:"Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Waiting Claim Final Verification",
    locked:1, berkasLengkap:true, claimDL:-7, cDays:25, sDays:24, smDays:22, clDays:19, omDays:15, pDays:8, uDays:8, hasPayment:true },

  // ── 22 · Paid · VERIFIKASI_TERHAMBAT_BERKAS critical (paid 12 hari, berkas TIDAK) ─
  { status:"Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Waiting Claim Final Verification",
    locked:1, berkasLengkap:false, claimDL:-10, cDays:30, sDays:29, smDays:27, clDays:24, omDays:20, pDays:12, uDays:12, hasPayment:true },

  // ── 23 · Paid, normal (paid 2 hari) ──────────────────────────────────────────
  { status:"Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Waiting Claim Final Verification",
    locked:1, berkasLengkap:true, claimDL:-1, cDays:16, sDays:15, smDays:13, clDays:11, omDays:8, pDays:2, uDays:2, hasPayment:true },

  // ── 24 · Paid, refund pending · REFUND_BELUM_LUNAS danger (updated 10 hari) ───
  { status:"Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Pending Refund",
    locked:1, berkasLengkap:true, claimDL:-15, cDays:35, sDays:34, smDays:32, clDays:29, omDays:25, pDays:18, uDays:10,
    hasPayment:true, hasRefund:true, batchRefundStatus:"Pending Refund" },

  // ── 25 · Paid, refund pending normal (updated 2 hari) ────────────────────────
  { status:"Paid", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Pending Refund",
    locked:1, berkasLengkap:true, claimDL:-5, cDays:22, sDays:21, smDays:19, clDays:17, omDays:13, pDays:9, uDays:2,
    hasPayment:true, hasRefund:true, batchRefundStatus:"Pending Refund" },

  // ── 26 · Approved by SM · DEADLINE_BERKAS_BELUM_LENGKAP danger (deadline 5 hari lalu) ─
  { status:"Approved by SM", smSt:"Approved by SM", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:false, claimDL:-5, cDays:18, sDays:17, smDays:14, uDays:14 },

  // ── 27 · Approved by SM · DEADLINE_BERKAS_BELUM_LENGKAP critical (deadline 15 hari lalu) ─
  { status:"Approved by SM", smSt:"Approved by SM", claimSt:"Not Started", omSt:"Not Started", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:false, claimDL:-15, cDays:28, sDays:27, smDays:24, uDays:24 },

  // ── 28 · Completed normal ─────────────────────────────────────────────────────
  { status:"Completed", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Completed",
    locked:1, berkasLengkap:true, claimDL:-25, cDays:60, sDays:59, smDays:57, clDays:54, omDays:51, pDays:40, uDays:30, hasPayment:true },

  // ── 29 · Completed normal ─────────────────────────────────────────────────────
  { status:"Completed", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Completed",
    locked:1, berkasLengkap:true, claimDL:-35, cDays:75, sDays:74, smDays:72, clDays:69, omDays:66, pDays:55, uDays:45, hasPayment:true },

  // ── 30 · Completed normal ─────────────────────────────────────────────────────
  { status:"Completed", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Completed",
    locked:1, berkasLengkap:true, claimDL:-45, cDays:90, sDays:89, smDays:87, clDays:84, omDays:80, pDays:70, uDays:60, hasPayment:true },

  // ── 31 · Completed, Fully Refunded ────────────────────────────────────────────
  { status:"Completed", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Paid", finalSt:"Fully Refunded",
    locked:1, berkasLengkap:true, claimDL:-50, cDays:95, sDays:94, smDays:92, clDays:89, omDays:85, pDays:75, uDays:55,
    hasPayment:true, hasRefund:true, batchRefundStatus:"Fully Refunded" },

  // ── 32 · Cancelled by OM ──────────────────────────────────────────────────────
  { status:"Cancelled by OM", smSt:"Approved by SM", claimSt:"Approved", omSt:"Cancelled", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:false, claimDL:-20, cDays:50, sDays:49, smDays:47, clDays:44, canDays:40, uDays:40 },

  // ── 33 · Cancelled by OM (lain) ───────────────────────────────────────────────
  { status:"Cancelled by OM", smSt:"Approved by SM", claimSt:"Approved", omSt:"Cancelled", finSt:"Not Started", finalSt:"Not Started",
    locked:1, berkasLengkap:false, claimDL:-30, cDays:65, sDays:64, smDays:62, clDays:59, canDays:55, uDays:55 },

  // ── 34 · Returned to Finance ──────────────────────────────────────────────────
  { status:"Returned to Finance", smSt:"Approved by SM", claimSt:"Approved", omSt:"Approved", finSt:"Need Correction", finalSt:"Not Started",
    locked:1, berkasLengkap:false, claimDL:-15, cDays:35, sDays:34, smDays:32, clDays:29, omDays:25, uDays:18 },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pickNominal(pi, batchIdx, itemIdx) {
  return NOMINALS[(pi * 3 + batchIdx * 7 + itemIdx * 11) % NOMINALS.length];
}

function pickStore(pi, batchIdx, itemIdx) {
  return STORES[(pi * 7 + batchIdx * 3 + itemIdx) % STORES.length];
}

function pickProduct(pi, batchIdx, itemIdx) {
  return PRODUCTS[(pi * 5 + batchIdx * 2 + itemIdx * 3) % PRODUCTS.length];
}

function pickType(batchIdx, itemIdx) {
  return PROG_TYPES[(batchIdx + itemIdx) % PROG_TYPES.length];
}

function pickCaraBayar(pi, batchIdx, itemIdx) {
  return CARA_BAYAR[(pi + batchIdx + itemIdx) % CARA_BAYAR.length];
}

// ─── SQL Builders ─────────────────────────────────────────────────────────────

function buildBatchInsert(batchId, noPengajuan, gelombang, principle, bulan, tahun, sc, totalNominal, paidAmount, verifiedAmount, refundAmt, totalRefunded, noClaimVal, claimDeadlineIso, completenessStatus) {
  const isCompleted  = sc.status === "Completed";
  const isPaid       = sc.status === "Paid" || isCompleted;
  const batchRefund  = sc.batchRefundStatus || "Not Applicable";
  const paidAt       = isPaid && !sc.partialPayment ? ago(sc.pDays) : null;
  const paymentDate  = isPaid && !sc.partialPayment ? iso(paidAt) : null;

  return {
    sql: `INSERT INTO off_batch (
      id, no_pengajuan, gelombang, principle_code, principle_name, bulan, tahun,
      supervisor_name, total_nominal, status, sm_status, claim_status, om_status,
      finance_status, final_status, locked, completeness_status,
      created_by, submitted_by, submitted_at,
      sm_approved_by, sm_approved_at, sm_note,
      returned_by, returned_at, return_note,
      claim_reviewed_by, claim_reviewed_at, claim_submitted_date, claim_deadline, no_claim, claim_note,
      om_approved_by, om_approved_at, om_note,
      cancelled_by, cancelled_at, cancel_note,
      paid_by, paid_at, payment_date, paid_amount, payment_method, payment_sender_bank,
      verified_amount, final_claim_note,
      pdf_status, receipt_pdf_status,
      refund_status, refund_amount, total_refunded,
      created_at, updated_at
    ) VALUES (
      ?,?,?,?,?,?,?,
      ?,?,?,?,?,?,
      ?,?,?,?,
      ?,?,?,
      ?,?,?,
      ?,?,?,
      ?,?,?,?,?,?,
      ?,?,?,
      ?,?,?,
      ?,?,?,?,?,?,
      ?,?,
      ?,?,
      ?,?,?,
      ?,?
    )`,
    args: [
      batchId, noPengajuan, gelombang, principle.code, principle.name, bulan, tahun,
      "Supervisor [DUMMY]", totalNominal, sc.status, sc.smSt, sc.claimSt, sc.omSt,
      sc.finSt, sc.finalSt, sc.locked, completenessStatus,
      "dummy-spv",
      sc.sDays != null ? "dummy-spv"  : null, ago(sc.sDays),
      sc.smDays != null ? "dummy-sm"  : null, ago(sc.smDays), sc.smDays != null ? "Disetujui" : null,
      sc.retDays != null ? "dummy-sm" : null, ago(sc.retDays), sc.retDays != null ? "Harap lengkapi dokumen dan revisi data" : null,
      sc.clDays != null ? "dummy-claim" : null, ago(sc.clDays), claimDeadlineIso, claimDeadlineIso, noClaimVal,
      sc.clDays != null ? "Berkas diverifikasi, proses ke OM" : null,
      sc.omDays != null ? "dummy-om"  : null, ago(sc.omDays), sc.omDays != null ? "Disetujui untuk pembayaran" : null,
      sc.canDays != null ? "dummy-om" : null, ago(sc.canDays), sc.canDays != null ? "Tidak memenuhi persyaratan program" : null,
      isPaid && !sc.partialPayment ? "dummy-finance" : null, paidAt, paymentDate,
      paidAmount, isPaid ? "Transfer" : null, isPaid ? "Bank BCA" : null,
      verifiedAmount, isCompleted ? "Semua dokumen final telah diverifikasi" : null,
      "pending", "pending",
      batchRefund, refundAmt, totalRefunded,
      ago(sc.cDays), ago(sc.uDays),
    ],
  };
}

function buildItemInsert(batchId, item, isCompleted, createdAt, updatedAt) {
  const docs = item.docsLengkap;
  // Minimal: kwt+foto selalu ada, sisanya tergantung berkasLengkap
  const kwt  = docs ? 1 : 1;
  const skp  = docs ? 1 : 0;
  const fp   = docs ? 1 : 0;
  const pc   = docs ? 1 : 0;
  const foto = 1; // foto selalu ada
  const rekap = docs ? 1 : 0;

  return {
    sql: `INSERT INTO off_batch_item (
      id, batch_id, item_no, row_no, no_surat, nama_program, periode,
      toko, barang, nominal, cara_bayar, type, original_type, normalized_type, type_is_legacy,
      pph_exempt, deadline,
      kwt, skp, fp, pc, foto, rekap, others,
      final_kwt, final_skp, final_fp, final_pc, final_foto, final_rekap,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      item.id, batchId, item.itemNo, item.itemNo, item.noSurat, item.namaProgram, item.periode,
      item.toko, item.barang, item.nominal, item.caraBayar,
      item.type, item.type, item.type, 0,
      0, item.deadline,
      kwt, skp, fp, pc, foto, rekap, 0,
      isCompleted ? kwt : 0, isCompleted ? skp : 0, isCompleted ? fp : 0,
      isCompleted ? pc : 0, isCompleted ? foto : 0, isCompleted ? rekap : 0,
      createdAt, updatedAt,
    ],
  };
}

function buildPaymentInsert(batchId, paymentNo, date, amount, method, note) {
  return {
    sql: `INSERT INTO off_payment (
      id, batch_id, payment_no, payment_date, paid_amount, payment_method,
      payment_sender_bank, note, created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      randomUUID(), batchId, paymentNo, date, amount, method,
      "Bank BCA", note, "dummy-spv", ago(0), ago(0),
    ],
  };
}

function buildRefundInsert(batchId, refundAmt, isVerified, daysAgo) {
  const status = isVerified ? "Verified" : "Pending";
  return {
    sql: `INSERT INTO off_refund (
      id, batch_id, refund_no, refund_amount, refund_method, refund_date,
      sender_name, receiver_bank, note, status,
      ${isVerified ? "verified_by, verified_at," : ""}
      created_by, created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?${isVerified ? ",?,?" : ""},?,?,?)`,
    args: [
      randomUUID(), batchId, 1, refundAmt, "Transfer",
      iso(ago(daysAgo + 1)), "Principal [DUMMY]", "Rekening Perusahaan",
      "Pengembalian selisih kelebihan bayar [DUMMY]", status,
      ...(isVerified ? ["dummy-finance", ago(daysAgo)] : []),
      "dummy-spv", ago(daysAgo), ago(daysAgo),
    ],
  };
}

function buildAuditInsert(batchId, createdAt, noPengajuan) {
  return {
    sql: `INSERT INTO off_audit_log (
      id, batch_id, actor_id, actor_name, actor_role,
      action, from_status, to_status, note, created_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [
      randomUUID(), batchId, "dummy-spv", "Supervisor [DUMMY]", "supervisor",
      "create_batch", null, "Draft",
      `[DUMMY] Batch dibuat: ${noPengajuan}`,
      createdAt,
    ],
  };
}

function buildPeriodClosureInsert(principle, bulan, tahun) {
  return {
    sql: `INSERT INTO off_period_closure (
      id, principle_code, principle_name, bulan, tahun, status,
      total_submitted, total_claimed, submitted_count, claimed_count,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      randomUUID(), principle.code, principle.name, bulan, tahun,
      "Terbuka", 0, 0, 0, 0, NOW, NOW,
    ],
  };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const db = createClient({ url: DB_URL });

  console.log(`\n🌱 Seed OPC Dummy Data`);
  console.log(`   DB   : ${DB_URL}`);
  console.log(`   Force: ${FORCE}\n`);

  // Force: hapus data dummy lama
  if (FORCE) {
    console.log("⚠️  --force: menghapus data dummy lama...");
    // Hapus dalam urutan child → parent (FK order)
    const principleCodeList = PRINCIPLES.map((p) => `'${p.code}'`).join(",");
    await db.execute("DELETE FROM off_audit_log  WHERE actor_name = 'Supervisor [DUMMY]'");
    await db.execute("DELETE FROM off_refund      WHERE created_by = 'dummy-spv'");
    await db.execute("DELETE FROM off_payment     WHERE created_by = 'dummy-spv'");
    await db.execute(`DELETE FROM off_batch_item
      WHERE batch_id IN (SELECT id FROM off_batch WHERE supervisor_name = 'Supervisor [DUMMY]')`);
    await db.execute(`DELETE FROM off_period_closure WHERE principle_code IN (${principleCodeList})`);
    await db.execute("DELETE FROM off_batch       WHERE supervisor_name = 'Supervisor [DUMMY]'");
    console.log("✓ Data dummy lama dihapus.\n");
  }

  // Load existing no_pengajuan (untuk idempotency)
  const existingRows = await db.execute(
    "SELECT no_pengajuan FROM off_batch WHERE supervisor_name = 'Supervisor [DUMMY]'"
  );
  const existingNP = new Set(existingRows.rows.map((r) => String(r[0])));

  // Load existing period closures
  const closureRows = await db.execute(
    "SELECT principle_code || '|' || bulan || '|' || tahun FROM off_period_closure"
  );
  const existingCL = new Set(closureRows.rows.map((r) => String(r[0])));

  let cntBatch = 0, cntItem = 0, cntPayment = 0, cntRefund = 0, cntClosure = 0;

  for (const [pi, principle] of PRINCIPLES.entries()) {
    process.stdout.write(
      `  [${String(pi + 1).padStart(2, " ")}/${PRINCIPLES.length}] ${principle.code.padEnd(8)} `
    );

    let suratSeq   = 1;
    let claimNoSeq = 1;
    let batchCountForPrincipal = 0;

    for (let batchIdx = 0; batchIdx < 51; batchIdx++) {
      const monthIdx  = Math.floor(batchIdx / 3);
      const gelombang = String((batchIdx % 3) + 1);
      const { b: bulan, y: tahun } = MONTHS[monthIdx];
      const sc = SC[batchIdx % SC.length];

      const noPengajuan = `${gelombang}/${principle.code}/${bulan}/${tahun}`;
      if (existingNP.has(noPengajuan)) continue;

      const batchId  = randomUUID();
      const numItems = (batchIdx % 4) + 1; // 1–4 items

      // Build items
      let totalNominal = 0;
      const items = [];
      for (let ii = 0; ii < numItems; ii++) {
        const nominal = pickNominal(pi, batchIdx, ii);
        totalNominal += nominal;
        items.push({
          id:          randomUUID(),
          itemNo:      ii + 1,
          noSurat:     `${principle.code}/DUMMY/${tahun}/${String(suratSeq++).padStart(5, "0")}`,
          namaProgram: `${pickType(batchIdx, ii)} - ${pickProduct(pi, batchIdx, ii)}`,
          periode:     `${tahun}-${bulan}-05 - ${tahun}-${bulan}-25`,
          toko:        pickStore(pi, batchIdx, ii),
          barang:      pickProduct(pi, batchIdx, ii),
          nominal,
          caraBayar:   pickCaraBayar(pi, batchIdx, ii),
          type:        pickType(batchIdx, ii),
          deadline:    iso(fwd(30)), // item deadline 30 hari ke depan (default)
          docsLengkap: sc.berkasLengkap,
        });
      }

      // Financial values
      const isCompleted   = sc.status === "Completed";
      const isPaidFull    = sc.status === "Paid" || isCompleted;
      const isPaidPartial = sc.partialPayment === true;
      const hasRefund     = sc.hasRefund === true;

      const paidAmount = isPaidFull
        ? totalNominal
        : isPaidPartial
        ? Math.floor(totalNominal * 0.6)
        : null;

      const verifiedAmount = isCompleted
        ? totalNominal
        : hasRefund
        ? Math.floor(totalNominal * 0.85)
        : null;

      const refundAmt     = hasRefund && verifiedAmount != null ? totalNominal - verifiedAmount : null;
      const totalRefunded = sc.batchRefundStatus === "Fully Refunded" ? refundAmt : null;

      // Claim number (jika sudah melewati claim review)
      const hasClaimNo = ["Claim Approved","OM Approved","Partial Paid","Paid","Completed","Cancelled by OM","Returned to Finance"].includes(sc.status);
      const noClaimVal = hasClaimNo
        ? `CLAIM/${principle.code}/${tahun}/${String(claimNoSeq++).padStart(4, "0")}`
        : null;

      // Claim deadline
      const claimDeadlineIso = sc.claimDL != null ? iso(fwd(sc.claimDL)) : null;

      // Completeness status
      const completenessStatus = sc.berkasLengkap ? "lengkap" : null;

      // Build all SQL statements for this batch
      const stmts = [];

      stmts.push(buildBatchInsert(
        batchId, noPengajuan, gelombang, principle, bulan, tahun, sc,
        totalNominal, paidAmount, verifiedAmount, refundAmt, totalRefunded,
        noClaimVal, claimDeadlineIso, completenessStatus
      ));

      const createdAt = ago(sc.cDays);
      const updatedAt = ago(sc.uDays);

      for (const item of items) {
        stmts.push(buildItemInsert(batchId, item, isCompleted, createdAt, updatedAt));
        cntItem++;
      }

      // Payment records
      if (sc.hasPayment) {
        if (isPaidPartial) {
          // Dua payment parsial: 40% + 20%
          const p1 = Math.floor(totalNominal * 0.4);
          const p2 = Math.floor(totalNominal * 0.2);
          const d1 = iso(ago((sc.pDays || 0) + 2));
          const d2 = iso(ago(sc.pDays || 0));
          stmts.push(buildPaymentInsert(batchId, 1, d1, p1, "Transfer", "Pembayaran pertama [DUMMY]"));
          stmts.push(buildPaymentInsert(batchId, 2, d2, p2, "Transfer", "Pembayaran kedua [DUMMY]"));
          cntPayment += 2;
        } else {
          const d = iso(ago(sc.pDays || 0));
          stmts.push(buildPaymentInsert(batchId, 1, d, totalNominal, "Transfer", "Pembayaran lunas [DUMMY]"));
          cntPayment++;
        }
      }

      // Refund record
      if (hasRefund && refundAmt) {
        const isVerified = sc.batchRefundStatus === "Fully Refunded";
        stmts.push(buildRefundInsert(batchId, refundAmt, isVerified, sc.uDays || 1));
        cntRefund++;
      }

      // Audit log (minimal create entry)
      stmts.push(buildAuditInsert(batchId, createdAt, noPengajuan));

      // Execute all statements for this batch atomically
      await db.batch(stmts, "write");

      cntBatch++;
      batchCountForPrincipal++;
    }

    // Period closure records untuk principal ini
    const closureStmts = [];
    for (const { b: bulan, y: tahun } of MONTHS) {
      const key = `${principle.code}|${bulan}|${tahun}`;
      if (existingCL.has(key)) continue;
      closureStmts.push(buildPeriodClosureInsert(principle, bulan, tahun));
      existingCL.add(key); // hindari duplikat dalam loop ini
      cntClosure++;
    }
    if (closureStmts.length > 0) {
      await db.batch(closureStmts, "write");
    }

    process.stdout.write(`→ ${batchCountForPrincipal} batch\n`);
  }

  db.close();

  console.log(`
✅ Seed selesai!
   Batch inserted    : ${cntBatch.toLocaleString()}
   Item inserted     : ${cntItem.toLocaleString()}
   Payment inserted  : ${cntPayment.toLocaleString()}
   Refund inserted   : ${cntRefund.toLocaleString()}
   Closure inserted  : ${cntClosure.toLocaleString()}

Cara jalankan ulang (hapus & seed ulang):
  node scripts/seed-opc-dummy.mjs --force
`);
}

main().catch((err) => {
  console.error("\n❌ Error:", err.message || err);
  process.exit(1);
});
