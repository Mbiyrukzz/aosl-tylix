import type { Schema, CreateTableBuilder } from "@tylix/shared";

export const up = async (schema: Schema) => {
    await schema.createTable("projects", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("company_id").index();
        table.string("title", 200);
        table.text("description").nullable();
        table.string("status", 20).default("not_started").index();
        table.string("priority", 20).default("normal");
        table.integer("progress").default(0);
        table.date("starts_on").nullable();
        table.date("due_on").nullable();
        table.datetime("completed_at").nullable();
        table.integer("lead_id").nullable();
        table.text("milestones").nullable();
        table.text("internal_notes").nullable();
        table.timestamps();
    });
    await schema.createTable("project_updates", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("project_id").index();
        table.integer("user_id");
        table.text("body");
        table.integer("progress").nullable();
        table.string("status", 20).nullable();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("project_updates");
    await schema.dropTable("projects");
};
