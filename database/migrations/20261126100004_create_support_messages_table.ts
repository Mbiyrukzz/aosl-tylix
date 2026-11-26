import type { Schema, CreateTableBuilder } from "@tylix/shared";

// The quick "Message support" conversations: one thread per client user.
// direction "in" is from the client, "out" is a reply from staff.
export const up = async (schema: Schema) => {
    await schema.createTable("support_messages", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("client_id").index();
        table.integer("company_id").nullable().index();
        table.integer("author_id");
        table.string("direction", 4).default("in");
        table.text("body");
        table.string("page_url").nullable();
        table.datetime("read_at").nullable();
        table.integer("ticket_id").nullable();
        table.timestamps();
        table.index(["client_id", "created_at"]);
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("support_messages");
};
