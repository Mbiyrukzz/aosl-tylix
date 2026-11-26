import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("companies", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("name", 200).notNullable();
        table.string("slug", 80).unique();
        table.string("tier", 20).default("silver").index();
        table.string("status", 20).default("active").index();
        table.string("email").nullable();
        table.string("phone", 40).nullable();
        table.string("website").nullable();
        table.string("address").nullable();
        table.string("kra_pin", 40).nullable();
        table.string("industry", 80).nullable();
        table.integer("account_manager_id").nullable();
        table.text("notes").nullable();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("companies");
};
