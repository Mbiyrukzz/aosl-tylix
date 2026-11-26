import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("leads", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("name", 120);
        table.string("email");
        table.string("phone", 40).nullable();
        table.string("company", 200).nullable();
        table.string("topic", 40).default("general");
        table.string("product", 40).nullable();
        table.text("message");
        table.string("status", 20).default("new").index();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("leads");
};
