import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("tickets", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("ref", 20).unique();
        table.integer("company_id").nullable().index();
        table.integer("user_id").index();
        table.string("subject", 200).notNullable();
        table.text("body");
        table.string("category", 30).default("technical");
        table.string("product", 40).nullable();
        table.string("priority", 20).default("normal").index();
        table.string("status", 20).default("open").index();
        table.string("source", 20).default("portal");
        table.integer("assigned_to").nullable().index();
        table.text("attachments").nullable();
        table.datetime("sla_due_at").nullable();
        table.datetime("first_response_at").nullable();
        table.datetime("resolved_at").nullable();
        table.datetime("last_activity_at").nullable();
        table.integer("rating").nullable();
        table.text("rating_comment").nullable();
        table.timestamps();
        table.index(["status", "last_activity_at"]);
    });
    await schema.createTable("ticket_replies", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("ticket_id").index();
        table.integer("user_id");
        table.text("body");
        table.boolean("internal").default(false);
        table.text("attachments").nullable();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("ticket_replies");
    await schema.dropTable("tickets");
};
