/**
 * Client portal API. Every route needs a session, and every query is
 * scoped to the caller's company (clientOnly + company_id checks), so a
 * client can never read another company's tickets, invoices or projects.
 */
import type { Router } from "@tylix/core";
import { createRateLimiter } from "@tylix/core";
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import { Ticket } from "../models/Ticket.js";
import { SupportMessage } from "../models/SupportMessage.js";
import { Notification } from "../models/Notification.js";
import { Subscription } from "../models/Subscription.js";
import { Project } from "../models/Project.js";
import { ProjectUpdate } from "../models/ProjectUpdate.js";
import { BillingDocument } from "../models/BillingDocument.js";
import { Announcement } from "../models/Announcement.js";
import { Incident } from "../models/Incident.js";
import { PasswordReset } from "../models/PasswordReset.js";
import { PRODUCT_SLUGS, OTHER_AREAS, TICKET_CATEGORIES, TICKET_PRIORITIES, productName } from "../services/catalog.js";
import { cleanAttachments, storeDataUrl } from "../services/files.js";
import { PAYBILL, presentDoc } from "../services/billing.js";
import { addReply, createTicket, presentTickets, ticketThread } from "../services/tickets.js";
import {
    type Row,
    APP_URL,
    byNewest,
    clientOnly,
    isStaff,
    notifyStaff,
    nowIso,
    num,
    oneOf,
    parseJson,
    safeUser,
    sendNotice,
    text,
    userDirectory,
    viewer,
} from "../services/portal.js";

type Handler = Parameters<Router["get"]>[1];

const messageLimiter = createRateLimiter({ name: "quick-support", max: 20, windowMs: 10 * 60 * 1000, store: "shared" });
const uploadLimiter = createRateLimiter({ name: "file-uploads", max: 30, windowMs: 10 * 60 * 1000, store: "shared" });
const AREAS = [...PRODUCT_SLUGS, ...OTHER_AREAS];
const ACTIVE_INCIDENT = ["investigating", "identified", "monitoring"];

function daysUntil(date: unknown): number | null {
    if (!date) return null;
    return Math.ceil((new Date(String(date)).getTime() - Date.now()) / 86400_000);
}

function presentSubscription(s: Row): Row {
    const days = daysUntil(s.renews_on);
    let state = s.status;
    if (s.status === "active" && days !== null && days <= 30) state = days < 0 ? "expired" : "renewing_soon";
    return { ...s, amount: num(s.amount), auto_renew: Boolean(s.auto_renew), product_name: s.product ? productName(s.product) : null, days_left: days, state };
}

function presentProject(p: Row): Row {
    const { internal_notes: _n, ...rest } = p;
    return { ...rest, milestones: parseJson(p.milestones, []) };
}

async function companyTickets(companyId: number) {
    return (await Ticket.where("company_id", companyId).get()) as Row[];
}

async function ownTicket(user: Row, id: unknown): Promise<Row | null> {
    const t = (await Ticket.find(Number(id))) as Row | null;
    if (!t || t.company_id !== user.company_id) return null;
    return t;
}

export async function routes(router: Router, { auth }: { auth: (handler: Handler) => Handler }) {
    // ── Account (any signed-in user, staff included) ────────────────
    router.get(
        "/api/account",
        auth(async (req, res) => {
            const user = await viewer(req);
            if (!user) return res.status(404).json({ error: "Account not found." });
            const company = user.company_id ? ((await Company.find(user.company_id)) as Row | null) : null;
            await User.update(user.id, { last_seen_at: nowIso() });
            return res.json({
                user: safeUser(user),
                company: company ? { id: company.id, name: company.name, tier: company.tier, status: company.status } : null,
                is_staff: isStaff(user),
            });
        }),
    );

    router.put(
        "/api/account",
        auth(async (req, res) => {
            const user = await viewer(req);
            if (!user) return res.status(404).json({ error: "Account not found." });
            const b = req.body ?? {};
            const name = text(b.name, 100);
            if (!name) return res.status(422).json({ errors: { name: ["Enter your name."] } });
            const avatar = b.avatar_url && /^\/uploads\/[a-f0-9]{32}\.(png|jpg|webp|gif)$/.test(String(b.avatar_url)) ? b.avatar_url : user.avatar_url ?? null;
            const updated = await User.update(user.id, {
                name,
                phone: text(b.phone, 40),
                job_title: text(b.job_title, 120),
                avatar_url: b.avatar_url === null ? null : avatar,
                notify_email: b.notify_email === false ? 0 : 1,
                notify_sms: b.notify_sms === true ? 1 : 0,
            });
            return res.json({ user: safeUser(updated as Row) });
        }),
    );

    router.post(
        "/api/uploads/file",
        auth(async (req, res) => {
            const limit = await uploadLimiter(String(req.user?.userId));
            if (!limit.allowed) return res.status(429).json({ error: "Too many uploads. Wait a few minutes." });
            const stored = await storeDataUrl(req.body?.data, req.body?.name);
            if ("error" in stored) return res.status(422).json({ error: stored.error });
            return res.status(201).json(stored);
        }),
    );

    // ── Notifications ───────────────────────────────────────────────
    router.get(
        "/api/notifications",
        auth(async (req, res) => {
            const rows = ((await Notification.where("user_id", req.user!.userId).orderBy("id", "DESC").limit(60).get()) as Row[]);
            return res.json({ items: rows, unread: rows.filter((n) => !n.read_at).length });
        }),
    );

    router.post(
        "/api/notifications/read-all",
        auth(async (req, res) => {
            // updateWhere compares with "=", which never matches NULL, so
            // the unread rows are found first and stamped one by one.
            const unread = (await Notification.where("user_id", req.user!.userId).whereNull("read_at").get()) as Row[];
            const now = nowIso();
            for (const n of unread) await Notification.update(n.id, { read_at: now });
            return res.json({ ok: true });
        }),
    );

    router.post(
        "/api/notifications/:id/read",
        auth(async (req, res) => {
            await Notification.updateWhere({ id: Number(req.params.id), user_id: req.user!.userId }, { read_at: nowIso() });
            return res.json({ ok: true });
        }),
    );

    // ── Overview ────────────────────────────────────────────────────
    router.get(
        "/api/portal/overview",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const cid = user.company_id;
            const company = cid ? ((await Company.find(cid)) as Row | null) : null;
            const tickets = cid ? await companyTickets(cid) : [];
            const subs = cid ? ((await Subscription.where("company_id", cid).get()) as Row[]).map(presentSubscription) : [];
            const docs = cid ? ((await BillingDocument.where("company_id", cid).get()) as Row[]).filter((d) => d.status !== "draft").map((d) => presentDoc(d)) : [];
            const projects = cid ? ((await Project.where("company_id", cid).get()) as Row[]).map(presentProject) : [];
            const unpaid = docs.filter((d) => d.kind === "invoice" && ["sent", "partial"].includes(d.status));
            const now = Date.now();
            const announcements = ((await Announcement.where("published", 1).get()) as Row[])
                .filter((a) => !a.expires_at || new Date(a.expires_at).getTime() > now)
                .filter((a) => a.audience !== "staff")
                .sort(byNewest())
                .slice(0, 3);
            const incidents = ((await Incident.all()) as Row[]).filter((i) => ACTIVE_INCIDENT.includes(i.status)).map((i) => ({ ...i, product_name: productName(i.product) }));
            const unreadMessages = ((await SupportMessage.where("client_id", user.id).where("direction", "out").get()) as Row[]).filter((m) => !m.read_at).length;
            const openTickets = tickets.filter((t) => !["resolved", "closed"].includes(t.status));
            const resolved = tickets.filter((t) => t.first_response_at && new Date(t.first_response_at).getTime() >= new Date(t.created_at).getTime());
            const avgResponseHours = resolved.length
                ? resolved.reduce((s, t) => s + (new Date(t.first_response_at).getTime() - new Date(t.created_at).getTime()), 0) / resolved.length / 3600_000
                : null;

            return res.json({
                company: company ? { id: company.id, name: company.name, tier: company.tier } : null,
                stats: {
                    open_tickets: openTickets.length,
                    awaiting_you: tickets.filter((t) => t.status === "awaiting_client").length,
                    balance_due: unpaid.reduce((s, d) => s + d.balance, 0),
                    overdue: unpaid.filter((d) => d.overdue).length,
                    active_services: subs.filter((s) => s.status === "active").length,
                    renewing_soon: subs.filter((s) => s.state === "renewing_soon" || s.state === "expired").length,
                    active_projects: projects.filter((p) => !["completed", "cancelled"].includes(p.status)).length,
                    avg_response_hours: avgResponseHours === null ? null : Math.round(avgResponseHours * 10) / 10,
                    unread_messages: unreadMessages,
                },
                tickets: (await presentTickets(tickets)).slice(0, 5),
                renewals: subs.filter((s) => s.days_left !== null && s.days_left <= 60 && s.status !== "cancelled").sort((a, b) => (a.days_left ?? 0) - (b.days_left ?? 0)).slice(0, 5),
                invoices: unpaid.sort((a, b) => String(a.due_on).localeCompare(String(b.due_on))).slice(0, 5),
                projects: projects.filter((p) => !["completed", "cancelled"].includes(p.status)).slice(0, 4),
                announcements,
                incidents,
                paybill: PAYBILL,
            });
        }),
    );

    // ── Tickets ─────────────────────────────────────────────────────
    router.get(
        "/api/portal/tickets",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const rows = user.company_id ? await companyTickets(user.company_id) : [];
            return res.json(await presentTickets(rows));
        }),
    );

    router.post(
        "/api/portal/tickets",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const b = req.body ?? {};
            const subject = text(b.subject, 200);
            const body = text(b.body, 8000);
            const errors: Record<string, string[]> = {};
            if (subject.length < 4) errors.subject = ["Give the ticket a short title (4 characters or more)."];
            if (body.length < 10) errors.body = ["Describe the issue in a little more detail."];
            if (Object.keys(errors).length) return res.status(422).json({ errors });
            const ticket = await createTicket({
                user,
                companyId: user.company_id,
                subject,
                body,
                category: oneOf(b.category, TICKET_CATEGORIES, "technical"),
                product: AREAS.includes(b.product) ? b.product : null,
                priority: oneOf(b.priority, TICKET_PRIORITIES, "normal"),
                source: "portal",
                attachments: cleanAttachments(b.attachments),
            });
            return res.status(201).json({ id: ticket.id, ref: ticket.ref });
        }),
    );

    router.get(
        "/api/portal/tickets/:id",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const t = await ownTicket(user, req.params.id);
            if (!t) return res.status(404).json({ error: "Ticket not found." });
            return res.json(await ticketThread(t, false));
        }),
    );

    router.post(
        "/api/portal/tickets/:id/replies",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const t = await ownTicket(user, req.params.id);
            if (!t) return res.status(404).json({ error: "Ticket not found." });
            if (t.status === "closed") return res.status(422).json({ error: "This ticket is closed. Reopen it to reply." });
            const body = text(req.body?.body, 8000);
            if (!body) return res.status(422).json({ errors: { body: ["Write a reply first."] } });
            await addReply(t, user, body, false, cleanAttachments(req.body?.attachments));
            return res.status(201).json(await ticketThread((await Ticket.find(t.id)) as Row, false));
        }),
    );

    router.post(
        "/api/portal/tickets/:id/status",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const t = await ownTicket(user, req.params.id);
            if (!t) return res.status(404).json({ error: "Ticket not found." });
            const action = oneOf(req.body?.action, ["resolve", "reopen"] as const, "reopen");
            if (action === "resolve") {
                await Ticket.update(t.id, { status: "resolved", resolved_at: nowIso(), last_activity_at: nowIso() });
                await notifyStaff({ kind: "ticket", title: `${user.name} marked ${t.ref} resolved`, body: t.subject, url: `/admin/tickets/${t.id}` });
            } else {
                await Ticket.update(t.id, { status: "open", resolved_at: null, last_activity_at: nowIso() });
                await notifyStaff({ kind: "ticket", title: `${user.name} reopened ${t.ref}`, body: t.subject, url: `/admin/tickets/${t.id}` });
            }
            return res.json(await ticketThread((await Ticket.find(t.id)) as Row, false));
        }),
    );

    router.post(
        "/api/portal/tickets/:id/rate",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const t = await ownTicket(user, req.params.id);
            if (!t) return res.status(404).json({ error: "Ticket not found." });
            if (!["resolved", "closed"].includes(t.status)) return res.status(422).json({ error: "You can rate a ticket once it's resolved." });
            const rating = Math.round(num(req.body?.rating));
            if (rating < 1 || rating > 5) return res.status(422).json({ error: "Pick 1 to 5 stars." });
            await Ticket.update(t.id, { rating, rating_comment: text(req.body?.comment, 1000) });
            await notifyStaff({ kind: "rating", title: `${t.ref} rated ${rating}/5`, body: text(req.body?.comment, 140) || t.subject, url: `/admin/tickets/${t.id}` });
            return res.json(await ticketThread((await Ticket.find(t.id)) as Row, false));
        }),
    );

    // ── Quick support messages (the floating button) ───────────────
    router.get(
        "/api/portal/messages",
        auth(async (req, res) => {
            const user = await viewer(req);
            if (!user) return res.status(401).json({ error: "Not signed in." });
            const rows = (await SupportMessage.where("client_id", user.id).orderBy("id", "ASC").get()) as Row[];
            const unreadIds = rows.filter((m) => m.direction === "out" && !m.read_at).map((m) => m.id);
            if (req.query?.peek !== "1" && unreadIds.length) {
                for (const id of unreadIds) await SupportMessage.update(id, { read_at: nowIso() });
            }
            const people = await userDirectory(rows.map((m) => m.author_id));
            return res.json({
                messages: rows.slice(-100).map((m) => ({
                    id: m.id,
                    body: m.body,
                    direction: m.direction,
                    author: people[m.author_id] ?? null,
                    ticket_id: m.ticket_id,
                    created_at: m.created_at,
                })),
                unread: req.query?.peek === "1" ? unreadIds.length : 0,
            });
        }),
    );

    router.get(
        "/api/portal/messages/unread",
        auth(async (req, res) => {
            const rows = (await SupportMessage.where("client_id", req.user!.userId).where("direction", "out").get()) as Row[];
            return res.json({ unread: rows.filter((m) => !m.read_at).length });
        }),
    );

    router.post(
        "/api/portal/messages",
        auth(async (req, res) => {
            const user = await viewer(req);
            if (!user) return res.status(401).json({ error: "Not signed in." });
            if (isStaff(user)) return res.status(422).json({ error: "Staff reply from the inbox in the console." });
            const limit = await messageLimiter(String(user.id));
            if (!limit.allowed) return res.status(429).json({ error: "You're sending messages very fast. Give us a moment to catch up." });
            const body = text(req.body?.body, 4000);
            if (body.length < 2) return res.status(422).json({ error: "Write a message first." });
            const pageUrl = text(req.body?.page_url, 250);
            const msg = (await SupportMessage.create({
                client_id: user.id,
                company_id: user.company_id ?? null,
                author_id: user.id,
                direction: "in",
                body,
                page_url: pageUrl,
            })) as Row;
            const company = user.company_id ? ((await Company.find(user.company_id)) as Row | null) : null;
            const from = `${user.name}${company ? " · " + company.name : ""}`;
            await notifyStaff(
                { kind: "message", title: `Message from ${from}`, body: body.slice(0, 160), url: `/admin/inbox?client=${user.id}` },
                {
                    subject: `Support message from ${from}`,
                    heading: `${user.name} sent a message`,
                    intro: `${company ? company.name + " · " + company.tier + " tier · " : ""}${user.email}${user.phone ? " · " + user.phone : ""}`,
                    quote: body,
                    lines: pageUrl ? [`Sent from: ${pageUrl}`] : [],
                    actionUrl: `${APP_URL}/admin/inbox?client=${user.id}`,
                    actionLabel: "Reply from the inbox",
                },
            );
            return res.status(201).json({ id: msg.id, body: msg.body, direction: "in", created_at: msg.created_at, author: { id: user.id, name: user.name } });
        }),
    );

    // ── Services ────────────────────────────────────────────────────
    router.get(
        "/api/portal/services",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const rows = user.company_id ? ((await Subscription.where("company_id", user.company_id).get()) as Row[]) : [];
            return res.json(rows.map(presentSubscription).sort((a, b) => (a.days_left ?? 9999) - (b.days_left ?? 9999)));
        }),
    );

    // A structured request (renewal, upgrade, Sender ID, new product,
    // quote) becomes a "request" ticket so it gets tracked like one.
    router.post(
        "/api/portal/requests",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const b = req.body ?? {};
            const type = oneOf(b.type, ["renewal", "upgrade", "cancel", "sender_id", "product", "quote", "sms_topup"] as const, "product");
            const product = AREAS.includes(b.product) ? b.product : type === "sender_id" || type === "sms_topup" ? "sms" : null;
            const lines: string[] = [];
            let subject = "";
            if (type === "renewal" || type === "upgrade" || type === "cancel") {
                const sub = (await Subscription.find(Number(b.subscription_id))) as Row | null;
                if (!sub || sub.company_id !== user.company_id) return res.status(404).json({ error: "Service not found." });
                const verb = { renewal: "Renew", upgrade: "Upgrade", cancel: "Cancel" }[type];
                subject = `${verb}: ${sub.name}`;
                lines.push(`Service: ${sub.name}${sub.plan ? " (" + sub.plan + ")" : ""}`, `Renews on: ${sub.renews_on ?? "n/a"}`);
            } else if (type === "sender_id") {
                const sender = text(b.sender_id, 11).toUpperCase();
                if (!/^[A-Z0-9][A-Z0-9 .-]{1,10}$/.test(sender)) return res.status(422).json({ errors: { sender_id: ["Sender IDs are 3 to 11 letters or numbers."] } });
                subject = `Sender ID registration: ${sender}`;
                lines.push(`Sender ID: ${sender}`, `Use: ${text(b.use_case, 200) || "n/a"}`, `Networks: ${text(b.networks, 120) || "All networks"}`);
            } else if (type === "sms_topup") {
                const units = Math.round(num(b.units));
                if (units < 100) return res.status(422).json({ errors: { units: ["Top up at least 100 SMS units."] } });
                subject = `SMS top-up: ${units.toLocaleString()} units`;
                lines.push(`Units: ${units.toLocaleString()}`);
            } else {
                subject = `${type === "quote" ? "Quote request" : "New product"}: ${product ? productName(product) : text(b.title, 120) || "Custom work"}`;
                if (b.users) lines.push(`Users / staff: ${text(b.users, 40)}`);
                if (b.timeline) lines.push(`Timeline: ${text(b.timeline, 80)}`);
                if (b.budget) lines.push(`Budget: ${text(b.budget, 80)}`);
            }
            const details = text(b.details, 4000);
            if (details) lines.push("", details);
            const ticket = await createTicket({
                user,
                companyId: user.company_id,
                subject,
                body: lines.join("\n") || subject,
                category: type === "renewal" || type === "cancel" || type === "sms_topup" ? "billing" : "request",
                product,
                priority: "normal",
                source: "request",
            });
            return res.status(201).json({ id: ticket.id, ref: ticket.ref });
        }),
    );

    // ── Projects ────────────────────────────────────────────────────
    router.get(
        "/api/portal/projects",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const rows = user.company_id ? ((await Project.where("company_id", user.company_id).get()) as Row[]) : [];
            return res.json(rows.sort(byNewest("updated_at")).map(presentProject));
        }),
    );

    router.get(
        "/api/portal/projects/:id",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const p = (await Project.find(Number(req.params.id))) as Row | null;
            if (!p || p.company_id !== user.company_id) return res.status(404).json({ error: "Project not found." });
            const updates = ((await ProjectUpdate.where("project_id", p.id).get()) as Row[]).sort(byNewest());
            const people = await userDirectory([p.lead_id, ...updates.map((u) => u.user_id)]);
            return res.json({
                project: { ...presentProject(p), lead: p.lead_id ? people[p.lead_id] ?? null : null },
                updates: updates.map((u) => ({ ...u, author: people[u.user_id] ?? null })),
            });
        }),
    );

    // ── Billing ─────────────────────────────────────────────────────
    router.get(
        "/api/portal/billing",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const rows = user.company_id ? ((await BillingDocument.where("company_id", user.company_id).get()) as Row[]) : [];
            return res.json({ documents: rows.filter((d) => d.status !== "draft").sort(byNewest()).map((d) => presentDoc(d)), paybill: PAYBILL });
        }),
    );

    router.get(
        "/api/portal/billing/:id",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d || d.company_id !== user.company_id || d.status === "draft") return res.status(404).json({ error: "Document not found." });
            const company = (await Company.find(d.company_id)) as Row | null;
            return res.json({ document: presentDoc(d, company?.name ?? ""), company: company ? { name: company.name, email: company.email, phone: company.phone, address: company.address, kra_pin: company.kra_pin } : null, paybill: PAYBILL });
        }),
    );

    router.post(
        "/api/portal/billing/:id/respond",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d || d.company_id !== user.company_id || d.kind !== "quote" || d.status !== "sent") return res.status(404).json({ error: "Quotation not found or already answered." });
            const accept = req.body?.decision === "accept";
            await BillingDocument.update(d.id, { status: accept ? "accepted" : "declined" });
            await notifyStaff(
                { kind: "billing", title: `${user.name} ${accept ? "accepted" : "declined"} ${d.number}`, body: text(req.body?.note, 200) || d.subject || "", url: `/admin/billing/${d.id}` },
                { subject: `Quotation ${d.number} ${accept ? "accepted" : "declined"}`, heading: `${user.name} ${accept ? "accepted" : "declined"} ${d.number}`, intro: d.subject ?? "", quote: text(req.body?.note, 1000), actionUrl: `${APP_URL}/admin/billing/${d.id}`, actionLabel: "Open quotation" },
            );
            return res.json({ ok: true, status: accept ? "accepted" : "declined" });
        }),
    );

    // "I've paid": the client sends the M-Pesa code; staff confirm it.
    router.post(
        "/api/portal/billing/:id/payment-notice",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            const d = (await BillingDocument.find(Number(req.params.id))) as Row | null;
            if (!d || d.company_id !== user.company_id || d.kind !== "invoice") return res.status(404).json({ error: "Invoice not found." });
            const reference = text(req.body?.reference, 40).toUpperCase();
            if (reference.length < 6) return res.status(422).json({ errors: { reference: ["Enter the M-Pesa or bank reference."] } });
            const method = oneOf(req.body?.method, ["mpesa", "bank", "cheque", "cash"] as const, "mpesa");
            await notifyStaff(
                { kind: "billing", title: `Payment notice for ${d.number}`, body: `${user.name}: ${method.toUpperCase()} ${reference} · ${text(req.body?.amount, 20)}`, url: `/admin/billing/${d.id}` },
                { subject: `Payment notice: ${d.number} (${reference})`, heading: `${user.name} says ${d.number} is paid`, intro: `${method.toUpperCase()} reference ${reference}${req.body?.amount ? " · amount " + text(req.body.amount, 20) : ""}`, actionUrl: `${APP_URL}/admin/billing/${d.id}`, actionLabel: "Confirm payment" },
            );
            return res.json({ ok: true });
        }),
    );

    // ── Company and team ────────────────────────────────────────────
    router.get(
        "/api/portal/company",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user) return;
            if (!user.company_id) return res.status(404).json({ error: "No company." });
            const company = (await Company.find(user.company_id)) as Row;
            const team = ((await User.where("company_id", user.company_id).get()) as Row[]).filter((u) => !isStaff(u));
            const manager = company.account_manager_id ? (await userDirectory([company.account_manager_id]))[company.account_manager_id] ?? null : null;
            const managerRow = company.account_manager_id ? ((await User.find(company.account_manager_id)) as Row | null) : null;
            const { notes: _n, ...pub } = company;
            return res.json({
                company: pub,
                manager: manager ? { ...manager, email: managerRow?.email, phone: managerRow?.phone } : null,
                team: team.map((u) => ({ id: u.id, name: u.name, email: u.email, job_title: u.job_title, avatar_url: u.avatar_url, verified: Boolean(u.email_verified_at), last_seen_at: u.last_seen_at, you: u.id === user.id })),
            });
        }),
    );

    router.put(
        "/api/portal/company",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user || !user.company_id) return;
            const b = req.body ?? {};
            const name = text(b.name, 200);
            if (!name) return res.status(422).json({ errors: { name: ["Company name is required."] } });
            await Company.update(user.company_id, {
                name,
                email: text(b.email, 200),
                phone: text(b.phone, 40),
                website: text(b.website, 200),
                address: text(b.address, 250),
                kra_pin: text(b.kra_pin, 40).toUpperCase(),
                industry: text(b.industry, 80),
            });
            return res.json({ ok: true });
        }),
    );

    router.post(
        "/api/portal/team",
        auth(async (req, res) => {
            const user = await clientOnly(req, res);
            if (!user || !user.company_id) return;
            const email = text(req.body?.email, 200).toLowerCase();
            const name = text(req.body?.name, 100);
            if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(422).json({ errors: { email: ["Enter a valid email address."] } });
            if (!name) return res.status(422).json({ errors: { name: ["Enter their name."] } });
            if (await User.findByEmail(email)) return res.status(422).json({ errors: { email: ["That email already has an account. Message support to move it to your company."] } });
            const created = await inviteUser({ name, email, companyId: user.company_id, jobTitle: text(req.body?.job_title, 120), invitedBy: user.name });
            return res.status(201).json({ id: created?.id });
        }),
    );
}

// Creates a verified client account with a random password and emails a
// "set your password" link (a password reset token, valid one hour).
export async function inviteUser(input: { name: string; email: string; companyId: number; jobTitle?: string; invitedBy: string; role?: string }) {
    const random = `${crypto.randomUUID()}${crypto.randomUUID()}`;
    const user = (await User.create({ name: input.name, email: input.email, password: random })) as Row | null;
    if (!user) return null;
    await User.update(user.id, { role: input.role ?? "client", company_id: input.role === "staff" || input.role === "admin" ? null : input.companyId, job_title: input.jobTitle ?? null });
    await User.markEmailVerified(user.id);
    const { rawToken } = (await PasswordReset.issue(user.email)) as { rawToken: string };
    const link = `${APP_URL}/reset-password?token=${rawToken}&email=${encodeURIComponent(user.email)}&welcome=1`;
    const company = input.companyId ? ((await Company.find(input.companyId)) as Row | null) : null;
    sendNotice(user.email, {
        subject: "You're invited to the Ashmif client portal",
        heading: `Welcome, ${input.name.split(" ")[0]}`,
        intro: `${input.invitedBy} added you to ${company ? company.name + " on " : ""}the Ashmif Office Solutions portal, where you can raise support tickets, follow projects and see invoices.`,
        lines: ["Set a password to get started. The link works for one hour; after that, use “Forgot password” on the sign-in page."],
        actionUrl: link,
        actionLabel: "Set your password",
    });
    return user;
}
