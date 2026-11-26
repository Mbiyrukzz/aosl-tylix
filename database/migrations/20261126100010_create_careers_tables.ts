import type { Schema, CreateTableBuilder } from "@tylix/shared";

// "jobs" is the queue's table, so openings live in job_openings.
export const up = async (schema: Schema) => {
    await schema.createTable("job_openings", (table: CreateTableBuilder) => {
        table.increments("id");
        table.string("title", 200);
        table.string("department", 40).default("engineering");
        table.string("location", 120).default("Mombasa, Kenya");
        table.string("employment", 20).default("full_time");
        table.text("summary").nullable();
        table.text("description");
        table.text("requirements").nullable();
        table.string("salary", 100).nullable();
        table.string("status", 20).default("open").index();
        table.timestamps();
    });
    await schema.createTable("job_applications", (table: CreateTableBuilder) => {
        table.increments("id");
        table.integer("opening_id").nullable().index();
        table.string("name", 120);
        table.string("email");
        table.string("phone", 40).nullable();
        table.string("portfolio").nullable();
        table.text("cover_letter").nullable();
        table.string("cv_url").nullable();
        table.string("cv_name").nullable();
        table.string("status", 20).default("new").index();
        table.timestamps();
    });
};

export const down = async (schema: Schema) => {
    await schema.dropTable("job_applications");
    await schema.dropTable("job_openings");
};
