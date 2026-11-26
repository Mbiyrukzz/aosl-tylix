import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("notifications", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("user_id").index();
        table.string("kind", 30).default("general");
        table.string("title", 200);
        table.text("body").nullable();
        table.string("url").nullable();
        table.datetime("read_at").nullable();
        table.timestamps();
        table.index(["user_id", "read_at"]);
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("notifications");
};
