/*
 * Tujuan: Skema Drizzle SQLite untuk Better Auth, RBAC, cache master, dan idempotency lokal.
 * Caller: Better Auth adapter, route handler Next.js, script init-db, dan service cache lokal.
 * Dependensi: drizzle-orm/sqlite-core.
 * Main Functions: table `user`, `session`, `account`, `verification`, `syncState`, `item`, `customer`, `idempotencyLog`.
 * Side Effects: Definisi schema untuk DB read/write SQLite oleh caller.
 */
import { sqliteTable, text, integer, real, index } from "drizzle-orm/sqlite-core";

export const user = sqliteTable("user", {
    id: text("id").primaryKey(),
    name: text('name').notNull(),
    email: text('email').notNull().unique(),
    emailVerified: integer('emailVerified', { mode: 'boolean' }).notNull(),
    image: text('image'),
    role: text('role').default('viewer'),
    permissions: text('permissions').default('{}'),
    banned: integer('banned', { mode: 'boolean' }).default(false),
    banReason: text('banReason'),
    banExpires: integer('banExpires', { mode: 'timestamp' }),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull()
});

export const session = sqliteTable("session", {
    id: text("id").primaryKey(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    token: text('token').notNull().unique(),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull(),
    ipAddress: text('ipAddress'),
    userAgent: text('userAgent'),
    userId: text('userId').notNull().references(() => user.id),
    impersonatedBy: text('impersonatedBy')
});

export const account = sqliteTable("account", {
    id: text("id").primaryKey(),
    accountId: text('accountId').notNull(),
    providerId: text('providerId').notNull(),
    userId: text('userId').notNull().references(() => user.id),
    accessToken: text('accessToken'),
    refreshToken: text('refreshToken'),
    idToken: text('idToken'),
    accessTokenExpiresAt: integer('accessTokenExpiresAt', { mode: 'timestamp' }),
    refreshTokenExpiresAt: integer('refreshTokenExpiresAt', { mode: 'timestamp' }),
    scope: text('scope'),
    password: text('password'),
    createdAt: integer('createdAt', { mode: 'timestamp' }).notNull(),
    updatedAt: integer('updatedAt', { mode: 'timestamp' }).notNull()
});

export const verification = sqliteTable("verification", {
    id: text("id").primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: integer('expiresAt', { mode: 'timestamp' }).notNull(),
    createdAt: integer('createdAt', { mode: 'timestamp' }),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
});

// --- Enterprise Data Pipeline & Mirroring Cache --- //

export const syncState = sqliteTable("sync_state", {
    module: text("module").primaryKey(), // e.g., 'item', 'customer'
    lastSyncTimestamp: text("last_sync_timestamp"), // ISO string watermark
    lastPage: integer("last_page").default(1), // Checkpoint for initial load
    status: text("status").default('idle'), // 'idle', 'syncing', 'error'
    updatedAt: integer('updated_at', { mode: 'timestamp' })
});

export const item = sqliteTable("item", {
    id: integer("id").primaryKey(), // Accurate's internal numeric ID
    no: text("no").notNull(), // Item number/SKU
    name: text("name").notNull(),
    itemType: text("itemType"),
    unitPrice: integer("unitPrice"),
    rawData: text("raw_data", { mode: 'json' }), // Complete unprocessed payload
    lastUpdate: text("last_update") // Accurate's modified timestamp
});

export const customer = sqliteTable("customer", {
    id: integer("id").primaryKey(), // Accurate's internal numeric ID
    customerNo: text("customerNo").notNull(), 
    name: text("name").notNull(),
    balance: integer("balance"),
    rawData: text("raw_data", { mode: 'json' }), // Complete unprocessed payload
    lastUpdate: text("last_update") // Accurate's modified timestamp
});

export const idempotencyLog = sqliteTable("idempotency_log", {
    key: text("key").primaryKey(), 
    status: text("status").notNull(), 
    invoiceNo: text("invoiceNo"),
    customerNo: text("customerNo"),
    amount: real("amount"),
    transDate: text("transDate"),
    paymentMethod: text("paymentMethod"),
    source: text("source"),
    createdAt: integer('createdAt', { mode: 'timestamp' }),
    updatedAt: integer('updatedAt', { mode: 'timestamp' })
});

// --- OFF Program Control --- //

export const offBatch = sqliteTable("off_batch", {
    id: text("id").primaryKey(),
    noPengajuan: text("no_pengajuan").notNull().unique(),
    gelombang: text("gelombang").notNull(),
    principleCode: text("principle_code").notNull(),
    principleName: text("principle_name").notNull(),
    bulan: text("bulan").notNull(),
    tahun: text("tahun").notNull(),
    supervisorName: text("supervisor_name").notNull(),
    totalNominal: real("total_nominal").notNull().default(0),
    status: text("status").notNull().default("Draft"),
    smStatus: text("sm_status").notNull().default("Not Started"),
    claimStatus: text("claim_status").notNull().default("Not Started"),
    omStatus: text("om_status").notNull().default("Not Started"),
    financeStatus: text("finance_status").notNull().default("Not Started"),
    finalStatus: text("final_status").notNull().default("Not Started"),
    locked: integer("locked", { mode: "boolean" }).notNull().default(false),
    createdBy: text("created_by"),
    submittedBy: text("submitted_by"),
    submittedAt: integer("submitted_at", { mode: "timestamp" }),
    smApprovedBy: text("sm_approved_by"),
    smApprovedAt: integer("sm_approved_at", { mode: "timestamp" }),
    smNote: text("sm_note"),
    returnedBy: text("returned_by"),
    returnedAt: integer("returned_at", { mode: "timestamp" }),
    returnNote: text("return_note"),
    claimReviewedBy: text("claim_reviewed_by"),
    claimReviewedAt: integer("claim_reviewed_at", { mode: "timestamp" }),
    claimSubmittedDate: text("claim_submitted_date"),
    claimDeadline: text("claim_deadline"),
    noClaim: text("no_claim"),
    claimNote: text("claim_note"),
    completenessStatus: text("completeness_status"),
    omApprovedBy: text("om_approved_by"),
    omApprovedAt: integer("om_approved_at", { mode: "timestamp" }),
    omNote: text("om_note"),
    cancelledBy: text("cancelled_by"),
    cancelledAt: integer("cancelled_at", { mode: "timestamp" }),
    cancelNote: text("cancel_note"),
    paidBy: text("paid_by"),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    paymentDate: text("payment_date"),
    paidAmount: real("paid_amount"),
    paymentProofPath: text("payment_proof_path"),
    paymentProofName: text("payment_proof_name"),
    paymentProofMime: text("payment_proof_mime"),
    paymentProofSize: integer("payment_proof_size"),
    paymentMethod: text("payment_method"),
    paymentSenderBank: text("payment_sender_bank"),
    financeNote: text("finance_note"),
    verifiedAmount: real("verified_amount"),
    finalClaimNote: text("final_claim_note"),
    pdfPath: text("pdf_path"),
    pdfGeneratedAt: integer("pdf_generated_at", { mode: "timestamp" }),
    pdfStatus: text("pdf_status").notNull().default("pending"),
    receiptPdfPath: text("receipt_pdf_path"),
    receiptPdfGeneratedAt: integer("receipt_pdf_generated_at", { mode: "timestamp" }),
    receiptPdfStatus: text("receipt_pdf_status").notNull().default("pending"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull()
});

export const offBatchItem = sqliteTable("off_batch_item", {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => offBatch.id),
    itemNo: integer("item_no").notNull(),
    rowNo: integer("row_no").notNull(),
    noSurat: text("no_surat"),
    noClaim: text("no_claim"),
    namaProgram: text("nama_program").notNull(),
    periode: text("periode"),
    toko: text("toko"),
    barang: text("barang"),
    nominal: real("nominal").notNull().default(0),
    caraBayar: text("cara_bayar"),
    type: text("type"),
    deadline: text("deadline"),
    kwt: integer("kwt", { mode: "boolean" }).notNull().default(false),
    skp: integer("skp", { mode: "boolean" }).notNull().default(false),
    fp: integer("fp", { mode: "boolean" }).notNull().default(false),
    pc: integer("pc", { mode: "boolean" }).notNull().default(false),
    foto: integer("foto", { mode: "boolean" }).notNull().default(false),
    rekap: integer("rekap", { mode: "boolean" }).notNull().default(false),
    others: integer("others", { mode: "boolean" }).notNull().default(false),
    othersText: text("others_text"),
    finalKwt: integer("final_kwt", { mode: "boolean" }).notNull().default(false),
    finalSkp: integer("final_skp", { mode: "boolean" }).notNull().default(false),
    finalFp: integer("final_fp", { mode: "boolean" }).notNull().default(false),
    finalPc: integer("final_pc", { mode: "boolean" }).notNull().default(false),
    finalFoto: integer("final_foto", { mode: "boolean" }).notNull().default(false),
    finalRekap: integer("final_rekap", { mode: "boolean" }).notNull().default(false),
    finalOthers: integer("final_others", { mode: "boolean" }).notNull().default(false),
    finalOthersText: text("final_others_text"),
    finalCompletenessNote: text("final_completeness_note"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
});

export const offPayment = sqliteTable("off_payment", {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => offBatch.id),
    paymentNo: integer("payment_no").notNull(),
    paymentDate: text("payment_date").notNull(),
    paidAmount: real("paid_amount").notNull().default(0),
    paymentMethod: text("payment_method").notNull(),
    paymentSenderBank: text("payment_sender_bank"),
    senderBank: text("sender_bank"),
    paymentProofPath: text("payment_proof_path"),
    paymentProofName: text("payment_proof_name"),
    paymentProofMime: text("payment_proof_mime"),
    paymentProofSize: integer("payment_proof_size"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
});

export const offNotification = sqliteTable("off_notification", {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => offBatch.id),
    type: text("type").notNull(),
    to: text("to").notNull(),
    subject: text("subject").notNull(),
    message: text("message").notNull(),
    status: text("status").notNull().default("created"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull()
});

export const offAuditLog = sqliteTable("off_audit_log", {
    id: text("id").primaryKey(),
    batchId: text("batch_id").notNull().references(() => offBatch.id),
    itemId: text("item_id"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull()
});

// --- Claim Workflow (may start after OFF OM Approved) --- //

export const claimWorkflow = sqliteTable("claim_workflow", {
    id: text("id").primaryKey(),
    offBatchId: text("off_batch_id").notNull().unique().references(() => offBatch.id),
    claimWorkflowNo: text("claim_workflow_no").notNull().unique(),
    principleCode: text("principle_code").notNull(),
    principleName: text("principle_name").notNull(),
    // Phase R7a — Multi No Claim + Direct Claim Source (additive only):
    // - `sourceType` mendokumentasikan asal data klaim. Saat ini selalu
    //   `off_program`; nilai `direct_kwitansi` dan `manual` disiapkan
    //   untuk Phase R7f (deferred). Tidak boleh dipakai sebagai gate atau
    //   business logic di R7a — kolom hanya metadata.
    // - `sourceRefId` adalah generic pointer ke sumber. Untuk
    //   `off_program`, nilai sama dengan `offBatchId`. Untuk source
    //   masa depan, akan menunjuk ke entitas lain (mis. receipt batch).
    // - `aggregateStatus` adalah status hasil derivasi dari semua
    //   submissions di workflow. Belum dipakai di R7a; akan menjadi
    //   source-of-truth display setelah R7e.
    sourceType: text("source_type").notNull().default("off_program"),
    sourceRefId: text("source_ref_id"),
    aggregateStatus: text("aggregate_status"),
    status: text("status").notNull().default("Draft"),
    totalDpp: real("total_dpp").notNull().default(0),
    totalPpn: real("total_ppn").notNull().default(0),
    totalPph: real("total_pph").notNull().default(0),
    totalClaim: real("total_claim").notNull().default(0),
    totalPaid: real("total_paid").notNull().default(0),
    remainingAmount: real("remaining_amount").notNull().default(0),
    submittedToPrincipalAt: integer("submitted_to_principal_at", { mode: "timestamp" }),
    claimLetterPdfPath: text("claim_letter_pdf_path"),
    claimLetterGeneratedAt: integer("claim_letter_generated_at", { mode: "timestamp" }),
    claimLetterGeneratedBy: text("claim_letter_generated_by"),
    // Phase R2 — Claim Documents:
    // Claim Workflow wajib menghasilkan tiga dokumen sebelum Mark Ready:
    // Claim Letter (Phase 2C, kolom di atas), Claim Summary, dan Kwitansi
    // Claim. Pola sama dengan Claim Letter: 1 PDF aktif per tipe, file
    // disimpan di folder runtime/claim-workflow/{summaries|receipts}, dan
    // metadata aktif disimpan di kolom-kolom di bawah ini. Versioning
    // historis tidak dimodelkan di phase ini; jejaknya tetap di
    // claim_audit_log via metadata `previousPdfPath`/`invalidated*`.
    summaryPdfPath: text("summary_pdf_path"),
    summaryGeneratedAt: integer("summary_generated_at", { mode: "timestamp" }),
    summaryGeneratedBy: text("summary_generated_by"),
    receiptPdfPath: text("receipt_pdf_path"),
    receiptGeneratedAt: integer("receipt_generated_at", { mode: "timestamp" }),
    receiptGeneratedBy: text("receipt_generated_by"),
    // No Claim utama untuk Claim Workflow. Disuplai oleh role admin/claim
    // setelah workflow dibuat. Saat di-set, di-sync ke semua
    // off_batch_item.no_claim pada OFF batch terkait dalam transaksi yang
    // sama. Empty string tidak boleh disimpan; gunakan NULL untuk "belum
    // ada". Lihat partial unique index `idx_claim_workflow_no_claim_unique`
    // di scripts/init-db.mjs.
    noClaim: text("no_claim"),
    noClaimAssignedAt: integer("no_claim_assigned_at", { mode: "timestamp" }),
    noClaimAssignedBy: text("no_claim_assigned_by"),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    // Phase R4 — Close Claim Workflow:
    // Metadata aktor + alasan saat workflow ditutup. Close hanya boleh
    // dilakukan via `POST /api/claim-workflow/[id]/close` setelah semua
    // gating terpenuhi (status Paid, remainingAmount 0, dokumen lengkap,
    // No Claim, minimal satu active payment, note non-empty). Lihat
    // docs/CLAIM_WORKFLOW_AI_CONTEXT.md.
    closedBy: text("closed_by"),
    closeNote: text("close_note"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull()
}, (table) => ({
    principleCodeIdx: index("idx_claim_workflow_principle_code").on(table.principleCode),
    statusIdx: index("idx_claim_workflow_status").on(table.status),
    createdAtIdx: index("idx_claim_workflow_created_at").on(table.createdAt),
    noClaimIdx: index("idx_claim_workflow_no_claim").on(table.noClaim),
}));

// Catatan cleanup PEKA (Mei 2026):
// - Kolom `nomor_ec_internal`, `ec_peka`, dan `cn_number` adalah artefak
//   workflow PEKA/EC/CN yang sekarang sudah retired. Mereka dihapus dari
//   skema aktif Drizzle agar route handler tidak bisa lagi membaca/menulis
//   field tsb. Database SQLite lokal lama mungkin masih punya kolom-kolom
//   tersebut secara fisik; itu aman selama tidak ada lagi kode aplikasi
//   yang membacanya. Untuk dev yang ingin DB bersih, jalankan reset:
//     node scripts/reset-data.mjs
//     node scripts/init-db.mjs
//     npm run seed:demo
export const claimWorkflowItem = sqliteTable("claim_workflow_item", {
    id: text("id").primaryKey(),
    claimWorkflowId: text("claim_workflow_id").notNull().references(() => claimWorkflow.id),
    // Phase R7a — Multi No Claim (additive):
    // Setiap item akan ditugaskan ke tepat satu `claim_submission` di phase
    // R7b ke depan. Di R7a kolom ini bersifat opsional / nullable supaya
    // backfill aman untuk row existing. Validasi 1:n (item -> submission)
    // diberlakukan di app layer mulai R7b.
    claimSubmissionId: text("claim_submission_id"),
    offBatchItemId: text("off_batch_item_id").references(() => offBatchItem.id),
    noSurat: text("no_surat"),
    jenisPromosi: text("jenis_promosi"),
    periode: text("periode"),
    outlet: text("outlet"),
    dpp: real("dpp").notNull().default(0),
    ppnRate: real("ppn_rate").notNull().default(0),
    ppnAmount: real("ppn_amount").notNull().default(0),
    pphRate: real("pph_rate").notNull().default(0),
    pphAmount: real("pph_amount").notNull().default(0),
    nilaiKlaim: real("nilai_klaim").notNull().default(0),
    status: text("status").notNull().default("Draft"),
    note: text("note"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
    workflowIdx: index("idx_claim_workflow_item_workflow_id").on(table.claimWorkflowId),
    offBatchItemIdx: index("idx_claim_workflow_item_off_batch_item_id").on(table.offBatchItemId),
    submissionIdx: index("idx_claim_workflow_item_submission_id").on(table.claimSubmissionId),
}));

export const claimPayment = sqliteTable("claim_payment", {
    id: text("id").primaryKey(),
    claimWorkflowId: text("claim_workflow_id").notNull().references(() => claimWorkflow.id),
    // Phase R7a — Multi No Claim (additive):
    // Payment akan pindah ke level submission di Phase R7d. Di R7a kolom
    // ini bersifat opsional dan diisi oleh migration backfill ke default
    // submission per workflow. `claimWorkflowId` tetap dipertahankan
    // sebagai redundant pointer agar query agregate tetap cepat dan
    // backward-compat dengan route existing.
    claimSubmissionId: text("claim_submission_id"),
    paymentDate: text("payment_date").notNull(),
    paymentAmount: real("payment_amount").notNull().default(0),
    paymentType: text("payment_type"),
    paymentNote: text("payment_note"),
    proofPath: text("proof_path"),
    createdBy: text("created_by"),
    // Phase R3 — Principal Payment + Outstanding:
    // Void adalah pengganti hard delete untuk koreksi pembayaran.
    // Active payment didefinisikan `voided_at IS NULL`. totalPaid hanya
    // menjumlahkan active payment. Audit log mencatat alasan void di
    // metadata + `void_reason` agar trace lengkap.
    voidedAt: integer("voided_at", { mode: "timestamp" }),
    voidedBy: text("voided_by"),
    voidReason: text("void_reason"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
    workflowIdx: index("idx_claim_payment_workflow_id").on(table.claimWorkflowId),
    voidedAtIdx: index("idx_claim_payment_voided_at").on(table.voidedAt),
    submissionIdx: index("idx_claim_payment_submission_id").on(table.claimSubmissionId),
}));

// Catatan cleanup PEKA (Mei 2026):
// - Tabel `claim_peka_report` dihapus dari skema aktif. Workflow PEKA/EC/CN
//   sudah retired; lihat `lib/claim-workflow/constants.ts` untuk status
//   production yang baru. SQLite lama mungkin masih memiliki tabel ini
//   secara fisik (DROP tidak otomatis dijalankan agar tidak destruktif);
//   itu aman selama aplikasi tidak lagi merujuk ke tabel tersebut.

export const claimAuditLog = sqliteTable("claim_audit_log", {
    id: text("id").primaryKey(),
    claimWorkflowId: text("claim_workflow_id").notNull().references(() => claimWorkflow.id),
    // Phase R7a — Multi No Claim (additive):
    // Audit tetap satu tabel terpusat. Untuk audit yang scope-nya satu
    // submission (mis. assign No Claim, generate dokumen submission),
    // kolom `claimSubmissionId` diisi dan `auditScope = "submission"`.
    // Audit existing biarkan NULL / `auditScope = "workflow"` supaya
    // timeline UI tetap bisa membedakan.
    claimSubmissionId: text("claim_submission_id"),
    auditScope: text("audit_scope"),
    actorId: text("actor_id"),
    actorName: text("actor_name"),
    actorRole: text("actor_role"),
    action: text("action").notNull(),
    fromStatus: text("from_status"),
    toStatus: text("to_status"),
    note: text("note"),
    metadata: text("metadata", { mode: "json" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
    workflowIdx: index("idx_claim_audit_log_workflow_id").on(table.claimWorkflowId),
    createdAtIdx: index("idx_claim_audit_log_created_at").on(table.createdAt),
    submissionIdx: index("idx_claim_audit_log_submission_id").on(table.claimSubmissionId),
}));

// Phase R7a — Multi No Claim + Direct Claim Source (additive):
// `claim_submission` adalah container baru untuk SATU No Claim. Satu
// `claim_workflow` boleh punya banyak `claim_submission`. Di R7a tabel ini
// hanya dibuat + di-backfill (1 default submission per workflow lama)
// supaya schema siap dipakai oleh Phase R7b ke depan. Tidak ada route
// existing yang membaca/menulis tabel ini di R7a — semua tetap operate
// di level `claim_workflow` agar R1-R6 berjalan tanpa regresi.
//
// Source-of-truth direncanakan pindah bertahap:
//   R7b — submission grouping + item assignment
//   R7c — documents per submission
//   R7d — payment + outstanding per submission
//   R7e — close + reports per submission, workflow status menjadi aggregate
//   R7f — direct kwitansi/manual source (deferred, butuh table rebuild)
//
// Aturan partial unique index `idx_claim_submission_no_claim_unique`
// memastikan No Claim tidak duplikat antar submission. Empty string tidak
// boleh disimpan (validasi tetap di app layer); jika lolos, tetap akan
// dianggap sama dan bentrok di unique index ini.
export const claimSubmission = sqliteTable("claim_submission", {
    id: text("id").primaryKey(),
    claimWorkflowId: text("claim_workflow_id").notNull().references(() => claimWorkflow.id),
    noClaim: text("no_claim"),
    noClaimAssignedAt: integer("no_claim_assigned_at", { mode: "timestamp" }),
    noClaimAssignedBy: text("no_claim_assigned_by"),
    // `scope` mendokumentasikan cara grouping No Claim.
    // Nilai valid (lihat lib/claim-workflow/constants.ts):
    //   per_pengajuan | per_program | per_toko | custom
    // `scopeLabel` adalah konteks human-readable (mis. nama program /
    // nama toko / "Pengajuan utama"). Tidak dipakai untuk gating.
    scope: text("scope").notNull().default("per_pengajuan"),
    scopeLabel: text("scope_label"),
    status: text("status").notNull().default("Draft"),
    totalDpp: real("total_dpp").notNull().default(0),
    totalPpn: real("total_ppn").notNull().default(0),
    totalPph: real("total_pph").notNull().default(0),
    totalClaim: real("total_claim").notNull().default(0),
    totalPaid: real("total_paid").notNull().default(0),
    remainingAmount: real("remaining_amount").notNull().default(0),
    submittedToPrincipalAt: integer("submitted_to_principal_at", { mode: "timestamp" }),
    claimLetterPdfPath: text("claim_letter_pdf_path"),
    claimLetterGeneratedAt: integer("claim_letter_generated_at", { mode: "timestamp" }),
    claimLetterGeneratedBy: text("claim_letter_generated_by"),
    summaryPdfPath: text("summary_pdf_path"),
    summaryGeneratedAt: integer("summary_generated_at", { mode: "timestamp" }),
    summaryGeneratedBy: text("summary_generated_by"),
    receiptPdfPath: text("receipt_pdf_path"),
    receiptGeneratedAt: integer("receipt_generated_at", { mode: "timestamp" }),
    receiptGeneratedBy: text("receipt_generated_by"),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    closedBy: text("closed_by"),
    closeNote: text("close_note"),
    createdBy: text("created_by"),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
}, (table) => ({
    workflowIdx: index("idx_claim_submission_workflow_id").on(table.claimWorkflowId),
    statusIdx: index("idx_claim_submission_status").on(table.status),
    // Partial unique index didefinisikan via init-db.mjs karena
    // drizzle-orm/sqlite-core tidak punya helper langsung untuk
    // partial-unique. Lihat scripts/init-db.mjs untuk DDL persis.
}));
