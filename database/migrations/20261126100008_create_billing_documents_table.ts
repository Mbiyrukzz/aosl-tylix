import type { Schema, CreateTableBuilder } from "@tylix/shared";

// Quotations and invoices share one table (kind). A paid invoice carries
// its receipt number, so there is exactly one receipt per invoice.
export const up = async (schema: Schema) => {
    await schema.createTable("billing_documents", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("kind", 10).default("invoice").index();
        table.string("number", 30).unique();
        table.integer("company_id").index();
        table.string("subject", 200).nullable();
        table.string("status", 20).default("draft").index();
        table.date("issued_on").nullable();
        table.date("due_on").nullable();
        table.string("currency", 3).default("KES");
        table.decimal("vat_rate", 5, 2).default(16);
        table.text("items");
        table.decimal("subtotal", 12, 2).default(0);
        table.decimal("vat", 12, 2).default(0);
        table.decimal("total", 12, 2).default(0);
        table.decimal("amount_paid", 12, 2).default(0);
        table.datetime("paid_at").nullable();
        table.string("payment_method", 40).nullable();
        table.string("payment_ref", 80).nullable();
        table.string("receipt_number", 30).nullable();
        table.integer("source_id").nullable();
        table.text("notes").nullable();
        table.integer("created_by").nullable();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("billing_documents");
};
