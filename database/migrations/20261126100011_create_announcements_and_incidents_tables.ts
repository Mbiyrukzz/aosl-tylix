import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("announcements", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("title", 200);
        table.text("body");
        table.string("level", 20).default("info");
        table.string("audience", 20).default("clients");
        table.boolean("published").default(true);
        table.datetime("expires_at").nullable();
        table.timestamps();
    });
    await schema.createTable("incidents", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("product", 40).index();
        table.string("title", 200);
        table.text("body").nullable();
        table.string("impact", 20).default("minor");
        table.string("status", 20).default("investigating").index();
        table.datetime("started_at").nullable();
        table.datetime("resolved_at").nullable();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("incidents");
    await schema.dropTable("announcements");
};
