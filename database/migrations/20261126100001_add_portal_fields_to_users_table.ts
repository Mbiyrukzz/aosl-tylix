import type { Schema, CreateTableBuilder } from "@tylix/shared";

// Who a user is in the AOS portal: a client (belongs to a company), staff
// or an admin. Clients see only their own company's data.
export const up = async (schema: Schema) => {
    await schema.alterTable("users", (table: any) => {
        table.string("role", 20).default("client").index();
        table.integer("company_id").nullable().index();
        table.string("phone", 40).nullable();
        table.string("job_title", 120).nullable();
        table.string("avatar_url").nullable();
        table.boolean("notify_email").default(true);
        table.boolean("notify_sms").default(false);
        table.datetime("last_seen_at").nullable();
    });
};

export const down = async (schema: Schema) => {
    await schema.alterTable("users", (table: any) => {
        for (const c of ["role", "company_id", "phone", "job_title", "avatar_url", "notify_email", "notify_sms", "last_seen_at"]) table.dropColumn(c);
    });
};
