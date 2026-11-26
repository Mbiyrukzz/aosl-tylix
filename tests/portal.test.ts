/**
 * Access rules for the AOS portal and console. Read-only against the
 * app's database: run `npx tylix db:seed` first (it creates the accounts
 * these tests sign in as). Nothing here creates or changes records.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createTestClient } from "@tylix/cli/testing";
import { User } from "../app/models/User.js";
import { Ticket } from "../app/models/Ticket.js";

const client = await createTestClient();
after(() => client.close());

const admin = await User.findByEmail("admin@ashmif.test");
const amina = await User.findByEmail("client@ashmif.test");
const bursar = await User.findByEmail("bursar@bahari.test");

test("the status page is public and lists every product", async () => {
    const res = await client.get("/api/public/status");
    assert.equal(res.status, 200);
    assert.equal(res.data.products.length, 8);
});

test("the contact form rejects incomplete messages without saving", async () => {
    const res = await client.post("/api/public/contact", { name: "", email: "nope", message: "hi" });
    assert.equal(res.status, 422);
    assert.ok(res.data.errors.email);
    assert.ok(res.data.errors.message);
});

test("portal and console need a session", async () => {
    assert.equal((await client.get("/api/portal/overview")).status, 401);
    assert.equal((await client.get("/api/admin/overview")).status, 401);
});

test("clients can't open the staff console", async () => {
    assert.ok(amina, "run npx tylix db:seed first");
    assert.equal((await client.get("/api/admin/tickets", { as: amina })).status, 403);
    assert.equal((await client.get("/api/admin/companies", { as: amina })).status, 403);
});

test("staff can open the console", async () => {
    assert.ok(admin, "run npx tylix db:seed first");
    const res = await client.get("/api/admin/overview", { as: admin });
    assert.equal(res.status, 200);
    assert.equal(typeof res.data.stats.open, "number");
});

test("a client only sees their own company's tickets", async () => {
    const res = await client.get("/api/portal/tickets", { as: amina });
    assert.equal(res.status, 200);
    for (const t of res.data) assert.equal(t.company_id, amina!.company_id);

    const other = (await Ticket.where("company_id", bursar!.company_id).first()) as { id: number } | null;
    assert.ok(other);
    assert.equal((await client.get(`/api/portal/tickets/${other.id}`, { as: amina })).status, 404);
});

test("clients never receive internal notes", async () => {
    for (const t of (await client.get("/api/portal/tickets", { as: amina })).data) {
        const res = await client.get(`/api/portal/tickets/${t.id}`, { as: amina });
        for (const r of res.data.replies) assert.equal(r.internal, false);
    }
});

test("draft invoices stay hidden from clients", async () => {
    const res = await client.get("/api/portal/billing", { as: amina });
    assert.equal(res.status, 200);
    for (const d of res.data.documents) assert.notEqual(d.status, "draft");
});
