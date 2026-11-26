/**
 * Staff console API (/api/admin/*). Every route needs a session and a
 * staff or admin role; managing staff accounts needs admin.
 */
import type { Router } from "@tylix/core";
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import { Ticket } from "../models/Ticket.js";
import { SupportMessage } from "../models/SupportMessage.js";
import { Subscription } from "../models/Subscription.js";
import { Project } from "../models/Project.js";
import { ProjectUpdate } from "../models/ProjectUpdate.js";
import { BillingDocument } from "../models/BillingDocument.js";
import { Lead } from "../models/Lead.js";
import { JobOpening } from "../models/JobOpening.js";
import { JobApplication } from "../models/JobApplication.js";
import { Announcement } from "../models/Announcement.js";
import { Incident } from "../models/Incident.js";
import { PRODUCT_SLUGS, OTHER_AREAS, TICKET_CATEGORIES, TICKET_PRIORITIES, TICKET_STATUSES, productName } from "../services/catalog.js";
import { cleanAttachments } from "../services/files.js";
import { cleanItems, nextNumber, presentDoc, totals, PAYBILL } from "../services/billing.js";
import { addReply, createTicket, presentTickets, ticketThread } from "../services/tickets.js";
import { inviteUser } from "./client.js";
import {
    type Row,
    APP_URL,
    adminOnly,
    byNewest,
    dateOnly,
    isStaff,
    money,
    notifyCompany,
    notifyUser,
    nowIso,
    num,
    oneOf,
    parseJson,
    safeUser,
    staffOnly,
    text,
    userDirectory,
} from "../services/portal.js";

type Handler = Parameters<Router["get"]>[1];

const AREAS = [...PRODUCT_SLUGS, ...OTHER_AREAS];
const TIERS = ["silver", "gold", "platinum"] as const;
const COMPANY_STATUSES = ["active", "onboarding", "on_hold", "archived"] as const;
const SUB_KINDS = ["subscription", "hosting", "domain", "email", "sms", "maintenance", "license", "support_plan", "other"] as const;
const SUB_STATUSES = ["active", "pending", "suspended", "cancelled", "expired"] as const;
const CYCLES = ["one_time", "monthly", "quarterly", "yearly"] as const;
const PROJECT_STATUSES = ["not_started", "in_progress", "review", "completed", "on_hold", "cancelled"] as const;
const ACTIVE_INCIDENT = ["investigating", "identified", "monitoring"];

function slugify(name: string): string {
    return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || `company-${Date.now()}`;
}

async function uniqueSlug(name: string, exceptId?: number): Promise<string> {
    const base = slugify(name);
    let slug = base;
    for (let i = 2; i < 200; i++) {
        const hit = (await Company.where("slug", slug).first()) as Row | null;
        if (!hit || hit.id === exceptId) return slug;
        slug = `${base}-${i}`;
    }
    return `${base}-${Date.now()}`;
}

async function companyMap(): Promise<Record<number, Row>> {
    const out: Record<number, Row> = {};
    for (const c of (await Company.all()) as Row[]) out[c.id] = c;
    return out;
}

function companyFields(b: Row) {
    return {
        email: text(b.email, 200),
        phone: text(b.phone, 40),
        website: text(b.website, 200),
        address: text(b.address, 250),
        kra_pin: text(b.kra_pin, 40).toUpperCase(),
        industry: text(b.industry, 80),
        tier: oneOf(b.tier, TIERS, "silver"),
        status: oneOf(b.status, COMPANY_STATUSES, "active"),
        account_manager_id: b.account_manager_id ? Number(b.account_manager_id) : null,
        notes: text(b.notes, 4000),
    };
}

function subscriptionFields(b: Row) {
    return {
        product: AREAS.includes(b.product) ? b.product : null,
        name: text(b.name, 200),
        kind: oneOf(b.kind, SUB_KINDS, "subscription"),
        plan: text(b.plan, 80),
        amount: Math.max(0, num(b.amount)),
        currency: text(b.currency, 3).toUpperCase() || "KES",
        cycle: oneOf(b.cycle, CYCLES, "yearly"),
        starts_on: dateOnly(b.starts_on),
        renews_on: dateOnly(b.renews_on),
        status: oneOf(b.status, SUB_STATUSES, "active"),
        auto_renew: b.auto_renew ? 1 : 0,
        reference: text(b.reference, 200),
        notes: text(b.notes, 2000),
    };
}

function projectFields(b: Row) {
    const milestones = Array.isArray(b.milestones)
        ? b.milestones.map((m: Row) => ({ title: text(m?.title, 160), done: Boolean(m?.done), due_on: dateOnly(m?.due_on) })).filter((m: Row) => m.title).slice(0, 30)
        : [];
    return {
        title: text(b.title, 200),
        description: text(b.description, 4000),
        status: oneOf(b.status, PROJECT_STATUSES, "not_started"),
        priority: oneOf(b.priority, TICKET_PRIORITIES, "normal"),
        progress: Math.min(100, Math.max(0, Math.round(num(b.progress)))),
        starts_on: dateOnly(b.starts_on),
        due_on: dateOnly(b.due_on),
        lead_id: b.lead_id ? Number(b.lead_id) : null,
        milestones: JSON.stringify(milestones),
        internal_notes: text(b.internal_notes, 4000),
    };
}

function presentSub(s: Row, companies: Record<number, Row> = {}) {
    const days = s.renews_on ? Math.ceil((new Date(s.renews_on).getTime() - Date.now()) / 86400_000) : null;
    return { ...s, amount: num(s.amount), auto_renew: Boolean(s.auto_renew), product_name: s.product ? productName(s.product) : null, days_left: days, company_name: companies[s.company_id]?.name ?? "" };
}

export async function routes(router: Router, { auth }: { auth: (handler: Handler) => Handler }) {
    // ── Overview ────────────────────────────────────────────────────
    router.get(
        "/api/admin/overview",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const tickets = (await Ticket.all()) as Row[];
            const open = tickets.filter((t) => !["resolved", "closed"].includes(t.status));
            const breached = open.filter((t) => !t.first_response_at && t.sla_due_at && new Date(t.sla_due_at).getTime() < Date.now());
            const messages = (await SupportMessage.all()) as Row[];
            const unreadThreads = new Set(messages.filter((m) => m.direction === "in" && !m.read_at).map((m) => m.client_id));
            const docs = ((await BillingDocument.all()) as Row[]).map((d) => presentDoc(d));
            const unpaid = docs.filter((d) => d.kind === "invoice" && ["sent", "partial"].includes(d.status));
            const thisMonth = new Date().toISOString().slice(0, 7);
            const collected = docs.filter((d) => d.paid_at && new Date(d.paid_at).toISOString().slice(0, 7) === thisMonth).reduce((s, d) => s + d.amount_paid, 0);
            const subs = (await Subscription.all()) as Row[];
            const renewals = subs.filter((s) => s.status === "active" && s.renews_on && new Date(s.renews_on).getTime() - Date.now() < 30 * 86400_000);
            const leads = (await Lead.where("status", "new").count()) as number;
            const applications = (await JobApplication.where("status", "new").count()) as number;
            const rated = tickets.filter((t) => t.rating);
            const responded = tickets.filter((t) => t.first_response_at && new Date(t.first_response_at).getTime() >= new Date(t.created_at).getTime());

            // Tickets opened per day, last 14 days.
            const days: { day: string; opened: number; resolved: number }[] = [];
            for (let i = 13; i >= 0; i--) {
                const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
                days.push({
                    day: d,
                    opened: tickets.filter((t) => new Date(t.created_at).toISOString().slice(0, 10) === d).length,
                    resolved: tickets.filter((t) => t.resolved_at && new Date(t.resolved_at).toISOString().slice(0, 10) === d).length,
                });
            }
            const byProduct: Record<string, number> = {};
            for (const t of open) byProduct[productName(t.product)] = (byProduct[productName(t.product)] ?? 0) + 1;

            const queue = (await presentTickets(open)).sort((a, b) => {
                if (a.sla_breached !== b.sla_breached) return a.sla_breached ? -1 : 1;
                return new Date(a.sla_due_at ?? 0).getTime() - new Date(b.sla_due_at ?? 0).getTime();
            });

            return res.json({
                stats: {
                    open: open.length,
                    unassigned: open.filter((t) => !t.assigned_to).length,
                    mine: open.filter((t) => t.assigned_to === me.id).length,
                    breached: breached.length,
                    unread_threads: unreadThreads.size,
                    new_leads: leads,
                    new_applications: applications,
                    outstanding: unpaid.reduce((s, d) => s + d.balance, 0),
                    overdue: unpaid.filter((d) => d.overdue).length,
                    collected_this_month: collected,
                    renewals_30d: renewals.length,
                    companies: ((await Company.all()) as Row[]).filter((c) => c.status !== "archived").length,
                    csat: rated.length ? Math.round((rated.reduce((s, t) => s + num(t.rating), 0) / rated.length) * 10) / 10 : null,
                    avg_first_response_hours: responded.length
                        ? Math.round((responded.reduce((s, t) => s + (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()), 0) / responded.length / 3600_000) * 10) / 10
                        : null,
                },
                volume: days,
                by_product: Object.entries(byProduct).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
                queue: queue.slice(0, 8),
                renewals: (await (async () => {
                    const cm = await companyMap();
                    return renewals.map((s) => presentSub(s, cm)).sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0)).slice(0, 6);
                })()),
            });
        }),
    );

    // Unread counts for the console's sidebar badges (polled).
    router.get(
        "/api/admin/pulse",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const messages = (await SupportMessage.where("direction", "in").whereNull("read_at").get()) as Row[];
            const tickets = (await Ticket.all()) as Row[];
            const open = tickets.filter((t) => ["open"].includes(t.status));
            return res.json({
                inbox: new Set(messages.map((m) => m.client_id)).size,
                tickets: open.length,
                leads: (await Lead.where("status", "new").count()) as number,
                applications: (await JobApplication.where("status", "new").count()) as number,
            });
        }),
    );

    router.get(
        "/api/admin/staff",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const staff = (await User.all()) as Row[];
            return res.json(staff.filter(isStaff).map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, job_title: u.job_title, avatar_url: u.avatar_url, last_seen_at: u.last_seen_at })));
        }),
    );

    router.post(
        "/api/admin/staff",
        auth(async (req, res) => {
            const me = await adminOnly(req, res);
            if (!me) return;
            const email = text(req.body?.email, 200).toLowerCase();
            const name = text(req.body?.name, 100);
            const role = oneOf(req.body?.role, ["staff", "admin"] as const, "staff");
            if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(422).json({ error: "Enter a name and a valid email." });
            const existing = (await User.findByEmail(email)) as Row | null;
            if (existing) {
                await User.update(existing.id, { role, company_id: null });
                return res.json({ id: existing.id, promoted: true });
            }
            const u = await inviteUser({ name, email, companyId: 0, invitedBy: me.name, role, jobTitle: text(req.body?.job_title, 120) });
            return res.status(201).json({ id: u?.id });
        }),
    );

    router.put(
        "/api/admin/staff/:id",
        auth(async (req, res) => {
            const me = await adminOnly(req, res);
            if (!me) return;
            const id = Number(req.params.id);
            if (id === me.id) return res.status(422).json({ error: "You can't change your own role." });
            const role = oneOf(req.body?.role, ["staff", "admin", "removed"] as const, "staff");
            await User.update(id, { role: role === "removed" ? "former_staff" : role });
            return res.json({ ok: true });
        }),
    );

    // ── Inbox (quick support messages) ──────────────────────────────
    router.get(
        "/api/admin/inbox",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const messages = (await SupportMessage.all()) as Row[];
            const threads: Record<number, Row> = {};
            for (const m of messages) {
                const t = (threads[m.client_id] ??= { client_id: m.client_id, company_id: m.company_id, unread: 0, count: 0, last: null });
                t.count++;
                if (m.direction === "in" && !m.read_at) t.unread++;
                if (!t.last || m.id > t.last.id) t.last = m;
            }
            const list = Object.values(threads);
            const people = await userDirectory(list.map((t) => t.client_id));
            const companies = await companyMap();
            return res.json(
                list
                    .map((t) => ({
                        client_id: t.client_id,
                        client: people[t.client_id] ?? { id: t.client_id, name: "Unknown" },
                        company: companies[t.company_id] ? { id: t.company_id, name: companies[t.company_id].name, tier: companies[t.company_id].tier } : null,
                        unread: t.unread,
                        count: t.count,
                        last_body: String(t.last.body).slice(0, 160),
                        last_direction: t.last.direction,
                        last_at: t.last.created_at,
                    }))
                    .sort((a, b) => new Date(b.last_at).getTime() - new Date(a.last_at).getTime()),
            );
        }),
    );

    router.get(
        "/api/admin/inbox/:clientId",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const clientId = Number(req.params.clientId);
            const client = (await User.find(clientId)) as Row | null;
            if (!client) return res.status(404).json({ error: "Client not found." });
            const rows = (await SupportMessage.where("client_id", clientId).orderBy("id", "ASC").get()) as Row[];
            const now = nowIso();
            for (const m of rows) if (m.direction === "in" && !m.read_at) await SupportMessage.update(m.id, { read_at: now });
            const people = await userDirectory(rows.map((m) => m.author_id));
            const company = client.company_id ? ((await Company.find(client.company_id)) as Row | null) : null;
            const openTickets = client.company_id ? ((await Ticket.where("company_id", client.company_id).get()) as Row[]).filter((t) => !["resolved", "closed"].includes(t.status)) : [];
            return res.json({
                client: { id: client.id, name: client.name, email: client.email, phone: client.phone, job_title: client.job_title, avatar_url: client.avatar_url ?? null, last_seen_at: client.last_seen_at },
                company: company ? { id: company.id, name: company.name, tier: company.tier } : null,
                open_tickets: (await presentTickets(openTickets)).slice(0, 5),
                messages: rows.map((m) => ({ id: m.id, body: m.body, direction: m.direction, author: people[m.author_id] ?? null, page_url: m.page_url, ticket_id: m.ticket_id, read_at: m.read_at, created_at: m.created_at })),
            });
        }),
    );

    router.post(
        "/api/admin/inbox/:clientId",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const clientId = Number(req.params.clientId);
            const client = (await User.find(clientId)) as Row | null;
            if (!client) return res.status(404).json({ error: "Client not found." });
            const body = text(req.body?.body, 4000);
            if (!body) return res.status(422).json({ error: "Write a reply first." });
            const msg = (await SupportMessage.create({ client_id: clientId, company_id: client.company_id ?? null, author_id: me.id, direction: "out", body })) as Row;
            await notifyUser(
                clientId,
                { kind: "message", title: `${me.name} replied to your message`, body: body.slice(0, 160), url: "/portal/messages" },
                {
                    email: {
                        subject: "Ashmif support replied to your message",
                        heading: `${me.name} replied`,
                        intro: "Here's the reply to the message you sent from the portal.",
                        quote: body,
                        actionUrl: `${APP_URL}/portal/messages`,
                        actionLabel: "Continue the conversation",
                    },
                },
            );
            return res.status(201).json({ id: msg.id, body: msg.body, direction: "out", author: { id: me.id, name: me.name, role: me.role }, created_at: msg.created_at });
        }),
    );

    // Turns a conversation into a tracked ticket.
    router.post(
        "/api/admin/inbox/:clientId/ticket",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const client = (await User.find(Number(req.params.clientId))) as Row | null;
            if (!client) return res.status(404).json({ error: "Client not found." });
            const rows = ((await SupportMessage.where("client_id", client.id).where("direction", "in").get()) as Row[]).sort((a, b) => a.id - b.id);
            const recent = rows.filter((m) => !m.ticket_id).slice(-5);
            if (recent.length === 0) return res.status(422).json({ error: "There are no new messages to turn into a ticket." });
            const subject = text(req.body?.subject, 200) || recent[recent.length - 1].body.slice(0, 80);
            const ticket = await createTicket({
                user: client,
                companyId: client.company_id ?? null,
                subject,
                body: recent.map((m) => m.body).join("\n\n"),
                category: oneOf(req.body?.category, TICKET_CATEGORIES, "technical"),
                product: AREAS.includes(req.body?.product) ? req.body.product : null,
                priority: oneOf(req.body?.priority, TICKET_PRIORITIES, "normal"),
                source: "message",
                createdByStaff: me,
            });
            for (const m of recent) await SupportMessage.update(m.id, { ticket_id: ticket.id });
            await Ticket.update(ticket.id, { assigned_to: me.id, status: "in_progress" });
            await SupportMessage.create({ client_id: client.id, company_id: client.company_id ?? null, author_id: me.id, direction: "out", body: `I've opened ticket ${ticket.ref} for this so we can track it to the end. You can follow it under Support tickets.`, ticket_id: ticket.id });
            return res.status(201).json({ id: ticket.id, ref: ticket.ref });
        }),
    );

    // ── Tickets ─────────────────────────────────────────────────────
    router.get(
        "/api/admin/tickets",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            return res.json(await presentTickets((await Ticket.all()) as Row[]));
        }),
    );

    router.post(
        "/api/admin/tickets",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const b = req.body ?? {};
            const client = (await User.find(Number(b.user_id))) as Row | null;
            if (!client || isStaff(client)) return res.status(422).json({ errors: { user_id: ["Pick the client this ticket is for."] } });
            const subject = text(b.subject, 200);
            const body = text(b.body, 8000);
            if (subject.length < 4 || body.length < 4) return res.status(422).json({ error: "Add a subject and a description." });
            const ticket = await createTicket({
                user: client,
                companyId: client.company_id ?? null,
                subject,
                body,
                category: oneOf(b.category, TICKET_CATEGORIES, "technical"),
                product: AREAS.includes(b.product) ? b.product : null,
                priority: oneOf(b.priority, TICKET_PRIORITIES, "normal"),
                source: oneOf(b.source, ["phone", "email", "whatsapp", "visit", "console"] as const, "console"),
                createdByStaff: me,
            });
            if (b.assign_to_me) await Ticket.update(ticket.id, { assigned_to: me.id });
            return res.status(201).json({ id: ticket.id, ref: ticket.ref });
        }),
    );

    router.get(
        "/api/admin/tickets/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const t = (await Ticket.find(Number(req.params.id))) as Row | null;
            if (!t) return res.status(404).json({ error: "Ticket not found." });
            const thread = await ticketThread(t, true);
            const requester = (await User.find(t.user_id)) as Row | null;
            const history = t.company_id ? (await presentTickets(((await Ticket.where("company_id", t.company_id).get()) as Row[]).filter((x) => x.id !== t.id))).slice(0, 5) : [];
            return res.json({ ...thread, requester: requester ? { id: requester.id, name: requester.name, email: requester.email, phone: requester.phone, job_title: requester.job_title } : null, history });
        }),
    );

    router.put(
        "/api/admin/tickets/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const t = (await Ticket.find(Number(req.params.id))) as Row | null;
            if (!t) return res.status(404).json({ error: "Ticket not found." });
            const b = req.body ?? {};
            const changes: Row = { last_activity_at: nowIso() };
            if (b.status !== undefined) {
                changes.status = oneOf(b.status, TICKET_STATUSES, t.status);
                if (changes.status === "resolved" && t.status !== "resolved") changes.resolved_at = nowIso();
                if (!["resolved", "closed"].includes(changes.status)) changes.resolved_at = null;
            }
            if (b.priority !== undefined) changes.priority = oneOf(b.priority, TICKET_PRIORITIES, t.priority);
            if (b.category !== undefined) changes.category = oneOf(b.category, TICKET_CATEGORIES, t.category);
            if (b.product !== undefined) changes.product = AREAS.includes(b.product) ? b.product : null;
            if (b.assigned_to !== undefined) changes.assigned_to = b.assigned_to ? Number(b.assigned_to) : null;
            await Ticket.update(t.id, changes);

            if (changes.status && changes.status !== t.status && ["resolved", "closed"].includes(changes.status)) {
                await notifyUser(
                    t.user_id,
                    { kind: "ticket", title: `${t.ref} was ${changes.status}`, body: `${t.subject}. Tell us how we did.`, url: `/portal/tickets/${t.id}` },
                    {
                        email: {
                            subject: `[${t.ref}] ${changes.status === "resolved" ? "Resolved" : "Closed"}: ${t.subject}`,
                            heading: `Your ticket is ${changes.status}`,
                            intro: `${me.name} marked ${t.ref} as ${changes.status}. If it's not fixed, reply and it reopens straight away.`,
                            actionUrl: `${APP_URL}/portal/tickets/${t.id}`,
                            actionLabel: "Rate our support",
                        },
                    },
                );
            }
            if (changes.assigned_to && changes.assigned_to !== t.assigned_to && changes.assigned_to !== me.id) {
                await notifyUser(changes.assigned_to, { kind: "ticket", title: `${me.name} assigned ${t.ref} to you`, body: t.subject, url: `/admin/tickets/${t.id}` });
            }
            return res.json(await ticketThread((await Ticket.find(t.id)) as Row, true));
        }),
    );

    router.post(
        "/api/admin/tickets/:id/replies",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const t = (await Ticket.find(Number(req.params.id))) as Row | null;
            if (!t) return res.status(404).json({ error: "Ticket not found." });
            const body = text(req.body?.body, 8000);
            if (!body) return res.status(422).json({ error: "Write a reply first." });
            const internal = Boolean(req.body?.internal);
            await addReply(t, me, body, internal, cleanAttachments(req.body?.attachments));
            if (!t.assigned_to && !internal) await Ticket.update(t.id, { assigned_to: me.id });
            if (req.body?.resolve && !internal) {
                await Ticket.update(t.id, { status: "resolved", resolved_at: nowIso() });
            }
            return res.status(201).json(await ticketThread((await Ticket.find(t.id)) as Row, true));
        }),
    );

    // ── Clients (companies and their people) ────────────────────────
    router.get(
        "/api/admin/companies",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const companies = (await Company.all()) as Row[];
            const users = (await User.all()) as Row[];
            const tickets = (await Ticket.all()) as Row[];
            const subs = (await Subscription.all()) as Row[];
            const docs = ((await BillingDocument.all()) as Row[]).map((d) => presentDoc(d));
            return res.json(
                companies.sort(byNewest()).map((c) => ({
                    ...c,
                    people: users.filter((u) => u.company_id === c.id && !isStaff(u)).length,
                    open_tickets: tickets.filter((t) => t.company_id === c.id && !["resolved", "closed"].includes(t.status)).length,
                    services: subs.filter((s) => s.company_id === c.id && s.status === "active").length,
                    balance: docs.filter((d) => d.company_id === c.id && d.kind === "invoice" && ["sent", "partial"].includes(d.status)).reduce((s, d) => s + d.balance, 0),
                })),
            );
        }),
    );

    router.post(
        "/api/admin/companies",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const name = text(req.body?.name, 200);
            if (!name) return res.status(422).json({ errors: { name: ["Company name is required."] } });
            const company = (await Company.create({ name, slug: await uniqueSlug(name), ...companyFields(req.body ?? {}) })) as Row;
            return res.status(201).json(company);
        }),
    );

    router.get(
        "/api/admin/companies/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const c = (await Company.find(Number(req.params.id))) as Row | null;
            if (!c) return res.status(404).json({ error: "Company not found." });
            const people = ((await User.where("company_id", c.id).get()) as Row[]).filter((u) => !isStaff(u));
            const subs = (await Subscription.where("company_id", c.id).get()) as Row[];
            const tickets = await presentTickets((await Ticket.where("company_id", c.id).get()) as Row[]);
            const projects = ((await Project.where("company_id", c.id).get()) as Row[]).map((p) => ({ ...p, milestones: parseJson(p.milestones, []) }));
            const docs = ((await BillingDocument.where("company_id", c.id).get()) as Row[]).sort(byNewest()).map((d) => presentDoc(d, c.name));
            return res.json({
                company: c,
                people: people.map((u) => ({ ...safeUser(u), verified: Boolean(u.email_verified_at) })),
                subscriptions: subs.map((s) => presentSub(s)),
                tickets,
                projects,
                documents: docs,
            });
        }),
    );

    router.put(
        "/api/admin/companies/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const c = (await Company.find(Number(req.params.id))) as Row | null;
            if (!c) return res.status(404).json({ error: "Company not found." });
            const name = text(req.body?.name, 200) || c.name;
            const updated = await Company.update(c.id, { name, slug: name === c.name ? c.slug : await uniqueSlug(name, c.id), ...companyFields(req.body ?? {}) });
            return res.json(updated);
        }),
    );

    router.post(
        "/api/admin/companies/:id/people",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const c = (await Company.find(Number(req.params.id))) as Row | null;
            if (!c) return res.status(404).json({ error: "Company not found." });
            const email = text(req.body?.email, 200).toLowerCase();
            const name = text(req.body?.name, 100);
            if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(422).json({ error: "Enter a name and a valid email." });
            const existing = (await User.findByEmail(email)) as Row | null;
            if (existing) {
                if (isStaff(existing)) return res.status(422).json({ error: "That email belongs to a staff account." });
                await User.update(existing.id, { company_id: c.id });
                return res.json({ id: existing.id, moved: true });
            }
            const u = await inviteUser({ name, email, companyId: c.id, jobTitle: text(req.body?.job_title, 120), invitedBy: `${me.name} (Ashmif)` });
            return res.status(201).json({ id: u?.id });
        }),
    );

    router.delete(
        "/api/admin/companies/:id/people/:userId",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const u = (await User.find(Number(req.params.userId))) as Row | null;
            if (!u || u.company_id !== Number(req.params.id)) return res.status(404).json({ error: "Person not found." });
            await User.update(u.id, { company_id: null });
            return res.json({ ok: true });
        }),
    );

    // Everyone, for pickers (e.g. "open a ticket for…").
    router.get(
        "/api/admin/clients",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const companies = await companyMap();
            const users = ((await User.all()) as Row[]).filter((u) => !isStaff(u) && u.role !== "former_staff");
            return res.json(users.map((u) => ({ id: u.id, name: u.name, email: u.email, company_id: u.company_id, company_name: companies[u.company_id]?.name ?? null })));
        }),
    );

    // ── Subscriptions ───────────────────────────────────────────────
    router.get(
        "/api/admin/subscriptions",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const cm = await companyMap();
            return res.json(((await Subscription.all()) as Row[]).map((s) => presentSub(s, cm)).sort((a, b) => (a.days_left ?? 99999) - (b.days_left ?? 99999)));
        }),
    );

    router.post(
        "/api/admin/subscriptions",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const fields = subscriptionFields(req.body ?? {});
            const companyId = Number(req.body?.company_id);
            if (!(await Company.find(companyId))) return res.status(422).json({ error: "Pick a company." });
            if (!fields.name) return res.status(422).json({ error: "Give the service a name." });
            const s = await Subscription.create({ ...fields, company_id: companyId });
            return res.status(201).json(s);
        }),
    );

    router.put(
        "/api/admin/subscriptions/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const s = (await Subscription.find(Number(req.params.id))) as Row | null;
            if (!s) return res.status(404).json({ error: "Service not found." });
            const fields = subscriptionFields(req.body ?? {});
            if (!fields.name) return res.status(422).json({ error: "Give the service a name." });
            return res.json(await Subscription.update(s.id, fields));
        }),
    );

    router.delete(
        "/api/admin/subscriptions/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            await Subscription.delete(Number(req.params.id));
            return res.json({ ok: true });
        }),
    );

    // ── Projects ────────────────────────────────────────────────────
    router.get(
        "/api/admin/projects",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const cm = await companyMap();
            const rows = (await Project.all()) as Row[];
            const people = await userDirectory(rows.map((p) => p.lead_id));
            return res.json(rows.sort(byNewest("updated_at")).map((p) => ({ ...p, milestones: parseJson(p.milestones, []), company_name: cm[p.company_id]?.name ?? "", lead: people[p.lead_id] ?? null })));
        }),
    );

    router.post(
        "/api/admin/projects",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const companyId = Number(req.body?.company_id);
            if (!(await Company.find(companyId))) return res.status(422).json({ error: "Pick a company." });
            const fields = projectFields(req.body ?? {});
            if (!fields.title) return res.status(422).json({ error: "Give the project a title." });
            const p = (await Project.create({ ...fields, company_id: companyId, lead_id: fields.lead_id ?? me.id })) as Row;
            await notifyCompany(companyId, { kind: "project", title: `New project: ${p.title}`, body: "Follow its progress in the portal.", url: `/portal/projects/${p.id}` });
            return res.status(201).json(p);
        }),
    );

    router.get(
        "/api/admin/projects/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const p = (await Project.find(Number(req.params.id))) as Row | null;
            if (!p) return res.status(404).json({ error: "Project not found." });
            const updates = ((await ProjectUpdate.where("project_id", p.id).get()) as Row[]).sort(byNewest());
            const people = await userDirectory([p.lead_id, ...updates.map((u) => u.user_id)]);
            const company = (await Company.find(p.company_id)) as Row | null;
            return res.json({
                project: { ...p, milestones: parseJson(p.milestones, []), company_name: company?.name ?? "", lead: people[p.lead_id] ?? null },
                updates: updates.map((u) => ({ ...u, author: people[u.user_id] ?? null })),
            });
        }),
    );

    router.put(
        "/api/admin/projects/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const p = (await Project.find(Number(req.params.id))) as Row | null;
            if (!p) return res.status(404).json({ error: "Project not found." });
            const fields = projectFields(req.body ?? {});
            if (!fields.title) return res.status(422).json({ error: "Give the project a title." });
            const completed = fields.status === "completed" && p.status !== "completed";
            const updated = await Project.update(p.id, { ...fields, completed_at: completed ? nowIso() : fields.status === "completed" ? p.completed_at : null });
            return res.json(updated);
        }),
    );

    // A client-visible update; can also move status and progress.
    router.post(
        "/api/admin/projects/:id/updates",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const p = (await Project.find(Number(req.params.id))) as Row | null;
            if (!p) return res.status(404).json({ error: "Project not found." });
            const body = text(req.body?.body, 4000);
            if (!body) return res.status(422).json({ error: "Write the update first." });
            const progress = req.body?.progress === "" || req.body?.progress == null ? null : Math.min(100, Math.max(0, Math.round(num(req.body.progress))));
            const status = req.body?.status ? oneOf(req.body.status, PROJECT_STATUSES, p.status) : null;
            await ProjectUpdate.create({ project_id: p.id, user_id: me.id, body, progress, status });
            const changes: Row = {};
            if (progress !== null) changes.progress = progress;
            if (status) {
                changes.status = status;
                if (status === "completed") changes.completed_at = nowIso();
            }
            if (Object.keys(changes).length) await Project.update(p.id, changes);
            else await Project.update(p.id, { progress: p.progress });
            await notifyCompany(
                p.company_id,
                { kind: "project", title: `Update on ${p.title}`, body: body.slice(0, 160), url: `/portal/projects/${p.id}` },
                {
                    email: {
                        subject: `Project update: ${p.title}`,
                        heading: `New update on ${p.title}`,
                        intro: `${me.name} posted an update${progress !== null ? ` · ${progress}% complete` : ""}.`,
                        quote: body,
                        actionUrl: `${APP_URL}/portal/projects/${p.id}`,
                        actionLabel: "See the project",
                    },
                },
            );
            return res.status(201).json({ ok: true });
        }),
    );

    // ── Billing ─────────────────────────────────────────────────────
    router.get(
        "/api/admin/billing",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const cm = await companyMap();
            return res.json(((await BillingDocument.all()) as Row[]).sort(byNewest()).map((d) => presentDoc(d, cm[d.company_id]?.name ?? "")));
        }),
    );

    router.post(
        "/api/admin/billing",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const b = req.body ?? {};
            const kind = oneOf(b.kind, ["invoice", "quote"] as const, "invoice");
            if (!(await Company.find(Number(b.company_id)))) return res.status(422).json({ error: "Pick a company." });
            const items = cleanItems(b.items);
            if (items.length === 0) return res.status(422).json({ error: "Add at least one line item." });
            const vatRate = Math.min(100, Math.max(0, num(b.vat_rate, 16)));
            const doc = await BillingDocument.create({
                kind,
                number: await nextNumber(kind === "quote" ? "QUO" : "INV"),
                company_id: Number(b.company_id),
                subject: text(b.subject, 200),
                status: "draft",
                issued_on: dateOnly(b.issued_on) ?? dateOnly(new Date()),
                due_on: dateOnly(b.due_on),
                currency: text(b.currency, 3).toUpperCase() || "KES",
                vat_rate: vatRate,
                items: JSON.stringify(items),
                ...totals(items, vatRate),
                amount_paid: 0,
                notes: text(b.notes, 2000),
                created_by: me.id,
            });
            return res.status(201).json(doc);
        }),
    );

    router.get(
        "/api/admin/billing/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d) return res.status(404).json({ error: "Document not found." });
            const c = (await Company.find(d.company_id)) as Row | null;
            return res.json({ document: presentDoc(d, c?.name ?? ""), company: c, paybill: PAYBILL });
        }),
    );

    router.put(
        "/api/admin/billing/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d) return res.status(404).json({ error: "Document not found." });
            if (d.status !== "draft") return res.status(422).json({ error: "Only drafts can be edited. Cancel it and issue a new one." });
            const b = req.body ?? {};
            const items = cleanItems(b.items);
            if (items.length === 0) return res.status(422).json({ error: "Add at least one line item." });
            const vatRate = Math.min(100, Math.max(0, num(b.vat_rate, 16)));
            return res.json(
                await BillingDocument.update(d.id, {
                    company_id: Number(b.company_id) || d.company_id,
                    subject: text(b.subject, 200),
                    issued_on: dateOnly(b.issued_on) ?? d.issued_on,
                    due_on: dateOnly(b.due_on),
                    currency: text(b.currency, 3).toUpperCase() || "KES",
                    vat_rate: vatRate,
                    items: JSON.stringify(items),
                    ...totals(items, vatRate),
                    notes: text(b.notes, 2000),
                }),
            );
        }),
    );

    router.delete(
        "/api/admin/billing/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d) return res.status(404).json({ error: "Document not found." });
            if (d.status === "draft") await BillingDocument.delete(d.id);
            else await BillingDocument.update(d.id, { status: "cancelled" });
            return res.json({ ok: true });
        }),
    );

    // Issue: the client can now see it, and everyone at the company is told.
    router.post(
        "/api/admin/billing/:id/send",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d) return res.status(404).json({ error: "Document not found." });
            if (!["draft", "sent"].includes(d.status)) return res.status(422).json({ error: "This document has already been answered or paid." });
            await BillingDocument.update(d.id, { status: "sent" });
            const label = d.kind === "quote" ? "quotation" : "invoice";
            await notifyCompany(
                d.company_id,
                { kind: "billing", title: `New ${label} ${d.number}`, body: `${d.subject ?? ""} · ${money(d.total, d.currency)}`, url: `/portal/billing/${d.id}` },
                {
                    email: {
                        subject: `${d.kind === "quote" ? "Quotation" : "Invoice"} ${d.number} from Ashmif Office Solutions`,
                        heading: `${d.kind === "quote" ? "Quotation" : "Invoice"} ${d.number}`,
                        intro: `${d.subject ? d.subject + " · " : ""}${money(d.total, d.currency)}${d.due_on && d.kind === "invoice" ? " · due " + String(d.due_on).slice(0, 10) : ""}`,
                        lines: d.kind === "invoice" && PAYBILL ? [`Pay with M-Pesa: Paybill ${PAYBILL}, account ${d.number}.`] : [],
                        actionUrl: `${APP_URL}/portal/billing/${d.id}`,
                        actionLabel: d.kind === "quote" ? "Review and accept" : "View invoice",
                    },
                },
            );
            return res.json({ ok: true });
        }),
    );

    router.post(
        "/api/admin/billing/:id/payment",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d || d.kind !== "invoice") return res.status(404).json({ error: "Invoice not found." });
            if (!["sent", "partial", "draft"].includes(d.status)) return res.status(422).json({ error: "This invoice isn't awaiting payment." });
            const amount = num(req.body?.amount);
            if (amount <= 0) return res.status(422).json({ error: "Enter the amount received." });
            const paid = Math.round((num(d.amount_paid) + amount) * 100) / 100;
            const full = paid >= num(d.total) - 0.009;
            const receipt = d.receipt_number || (full ? await nextNumber("RCT") : null);
            await BillingDocument.update(d.id, {
                amount_paid: paid,
                status: full ? "paid" : "partial",
                paid_at: full ? nowIso() : d.paid_at,
                payment_method: oneOf(req.body?.method, ["mpesa", "bank", "cheque", "cash", "card"] as const, "mpesa"),
                payment_ref: text(req.body?.reference, 80).toUpperCase(),
                receipt_number: receipt,
            });
            await notifyCompany(
                d.company_id,
                { kind: "billing", title: full ? `Payment received for ${d.number}` : `Part payment received for ${d.number}`, body: `${money(amount, d.currency)} · thank you`, url: `/portal/billing/${d.id}` },
                {
                    email: {
                        subject: full ? `Receipt ${receipt} for ${d.number}` : `Part payment received for ${d.number}`,
                        heading: "Thank you for your payment",
                        intro: `We received ${money(amount, d.currency)} against ${d.number}.${full ? ` Your receipt number is ${receipt}.` : ` Balance: ${money(num(d.total) - paid, d.currency)}.`}`,
                        actionUrl: `${APP_URL}/portal/billing/${d.id}`,
                        actionLabel: full ? "View receipt" : "View invoice",
                    },
                },
            );
            return res.json({ ok: true });
        }),
    );

    // Accepted quotation → a draft invoice with the same lines.
    router.post(
        "/api/admin/billing/:id/convert",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d || d.kind !== "quote") return res.status(404).json({ error: "Quotation not found." });
            if (d.status === "converted") return res.status(422).json({ error: "Already converted." });
            const due = new Date(Date.now() + 14 * 86400_000);
            const inv = (await BillingDocument.create({
                kind: "invoice",
                number: await nextNumber("INV"),
                company_id: d.company_id,
                subject: d.subject,
                status: "draft",
                issued_on: dateOnly(new Date()),
                due_on: dateOnly(due),
                currency: d.currency,
                vat_rate: d.vat_rate,
                items: d.items,
                subtotal: d.subtotal,
                vat: d.vat,
                total: d.total,
                amount_paid: 0,
                source_id: d.id,
                notes: d.notes,
                created_by: me.id,
            })) as Row;
            await BillingDocument.update(d.id, { status: "converted" });
            return res.status(201).json({ id: inv.id, number: inv.number });
        }),
    );

    // ── Leads and careers ───────────────────────────────────────────
    router.get(
        "/api/admin/leads",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            return res.json(((await Lead.all()) as Row[]).sort(byNewest()).map((l) => ({ ...l, product_name: l.product ? productName(l.product) : null })));
        }),
    );

    router.put(
        "/api/admin/leads/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            await Lead.update(Number(req.params.id), { status: oneOf(req.body?.status, ["new", "contacted", "qualified", "won", "lost"] as const, "contacted") });
            return res.json({ ok: true });
        }),
    );

    // A lead that becomes a client: company + first user, invited.
    router.post(
        "/api/admin/leads/:id/convert",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const lead = (await Lead.find(Number(req.params.id))) as Row | null;
            if (!lead) return res.status(404).json({ error: "Lead not found." });
            if (await User.findByEmail(lead.email)) return res.status(422).json({ error: "That email already has an account." });
            const name = lead.company || `${lead.name}`;
            const company = (await Company.create({ name, slug: await uniqueSlug(name), tier: "silver", status: "onboarding", email: lead.email, phone: lead.phone, account_manager_id: me.id })) as Row;
            await inviteUser({ name: lead.name, email: lead.email, companyId: company.id, invitedBy: `${me.name} (Ashmif)` });
            await Lead.update(lead.id, { status: "won" });
            return res.status(201).json({ company_id: company.id });
        }),
    );

    router.get(
        "/api/admin/careers",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const openings = ((await JobOpening.all()) as Row[]).sort(byNewest());
            const apps = ((await JobApplication.all()) as Row[]).sort(byNewest());
            const titles: Record<number, string> = {};
            for (const o of openings) titles[o.id] = o.title;
            return res.json({
                openings: openings.map((o) => ({ ...o, applications: apps.filter((a) => a.opening_id === o.id).length })),
                applications: apps.map((a) => ({ ...a, role: a.opening_id ? titles[a.opening_id] ?? "Closed role" : "General application" })),
            });
        }),
    );

    const openingFields = (b: Row) => ({
        title: text(b.title, 200),
        department: oneOf(b.department, ["engineering", "design", "product", "support", "sales", "operations"] as const, "engineering"),
        location: text(b.location, 120) || "Mombasa, Kenya",
        employment: oneOf(b.employment, ["full_time", "part_time", "contract", "internship"] as const, "full_time"),
        summary: text(b.summary, 400),
        description: text(b.description, 10000),
        requirements: text(b.requirements, 5000),
        salary: text(b.salary, 100),
        status: oneOf(b.status, ["open", "closed"] as const, "open"),
    });

    router.post(
        "/api/admin/careers",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const f = openingFields(req.body ?? {});
            if (!f.title || !f.description) return res.status(422).json({ error: "A role needs a title and a description." });
            return res.status(201).json(await JobOpening.create(f));
        }),
    );

    router.put(
        "/api/admin/careers/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const f = openingFields(req.body ?? {});
            if (!f.title || !f.description) return res.status(422).json({ error: "A role needs a title and a description." });
            return res.json(await JobOpening.update(Number(req.params.id), f));
        }),
    );

    router.put(
        "/api/admin/applications/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            await JobApplication.update(Number(req.params.id), { status: oneOf(req.body?.status, ["new", "reviewing", "shortlisted", "interview", "rejected", "hired"] as const, "reviewing") });
            return res.json({ ok: true });
        }),
    );

    // ── Announcements and status ────────────────────────────────────
    router.get(
        "/api/admin/broadcasts",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            return res.json({
                announcements: ((await Announcement.all()) as Row[]).sort(byNewest()),
                incidents: ((await Incident.all()) as Row[]).sort(byNewest("started_at")).map((i) => ({ ...i, product_name: productName(i.product), active: ACTIVE_INCIDENT.includes(i.status) })),
            });
        }),
    );

    router.post(
        "/api/admin/announcements",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const b = req.body ?? {};
            const title = text(b.title, 200);
            const body = text(b.body, 4000);
            if (!title || !body) return res.status(422).json({ error: "Add a title and a message." });
            const a = (await Announcement.create({
                title,
                body,
                level: oneOf(b.level, ["info", "new", "maintenance", "warning"] as const, "info"),
                audience: oneOf(b.audience, ["clients", "everyone", "staff"] as const, "clients"),
                published: b.published === false ? 0 : 1,
                expires_at: b.expires_at ? new Date(b.expires_at).toISOString() : null,
            })) as Row;
            return res.status(201).json(a);
        }),
    );

    router.put(
        "/api/admin/announcements/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            await Announcement.update(Number(req.params.id), { published: req.body?.published ? 1 : 0 });
            return res.json({ ok: true });
        }),
    );

    router.delete(
        "/api/admin/announcements/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            await Announcement.delete(Number(req.params.id));
            return res.json({ ok: true });
        }),
    );

    router.post(
        "/api/admin/incidents",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const b = req.body ?? {};
            if (!PRODUCT_SLUGS.includes(b.product)) return res.status(422).json({ error: "Pick the affected product." });
            const title = text(b.title, 200);
            if (!title) return res.status(422).json({ error: "Describe the incident in a line." });
            return res.status(201).json(
                await Incident.create({
                    product: b.product,
                    title,
                    body: text(b.body, 4000),
                    impact: oneOf(b.impact, ["minor", "major", "maintenance"] as const, "minor"),
                    status: "investigating",
                    started_at: nowIso(),
                }),
            );
        }),
    );

    router.put(
        "/api/admin/incidents/:id",
        auth(async (req, res) => {
            const me = await staffOnly(req, res);
            if (!me) return;
            const i = (await Incident.find(Number(req.params.id))) as Row | null;
            if (!i) return res.status(404).json({ error: "Incident not found." });
            const status = oneOf(req.body?.status, ["investigating", "identified", "monitoring", "resolved"] as const, i.status);
            const note = text(req.body?.note, 2000);
            await Incident.update(i.id, {
                status,
                body: note ? `${i.body ? i.body + "\n\n" : ""}[${status}] ${note}` : i.body,
                resolved_at: status === "resolved" ? nowIso() : null,
            });
            return res.json({ ok: true });
        }),
    );
}
