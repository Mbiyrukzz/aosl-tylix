import type { Schema, CreateTableBuilder } from "@tylix/shared";

// A product or service a client company is on: a MediSynq plan, hosting,
// a domain, a Sender ID, a support plan.
export const up = async (schema: Schema) => {
    await schema.createTable("subscriptions", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("company_id").index();
        table.string("product", 40).nullable();
        table.string("name", 200);
        table.string("kind", 30).default("subscription");
        table.string("plan", 80).nullable();
        table.decimal("amount", 12, 2).default(0);
        table.string("currency", 3).default("KES");
        table.string("cycle", 20).default("yearly");
        table.date("starts_on").nullable();
        table.date("renews_on").nullable().index();
        table.string("status", 20).default("active").index();
        table.boolean("auto_renew").default(false);
        table.string("reference").nullable();
        table.text("notes").nullable();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("subscriptions");
};
