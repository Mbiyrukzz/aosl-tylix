import { Ticket } from "../models/Ticket.js";
import { TicketReply } from "../models/TicketReply.js";
import { Company } from "../models/Company.js";
import { User } from "../models/User.js";
import { productName } from "./catalog.js";
import { type Row, APP_URL, isStaff, notifyStaff, notifyUser, nowIso, parseJson, slaDueAt, smsUser, userDirectory, byNewest } from "./portal.js";
import { shortLink } from "./sms.js";
import type { StoredFile } from "./files.js";

export interface NewTicket {
    user: Row;
    companyId: number | null;
    subject: string;
    body: string;
    category: string;
    product: string | null;
    priority: string;
    source: string;
    attachments?: StoredFile[];
    createdByStaff?: Row | null;
}

export async function createTicket(input: NewTicket): Promise<Row> {
    const company = input.companyId ? ((await Company.find(input.companyId)) as Row | null) : null;
    const now = nowIso();
    const ticket = (await Ticket.create({
        ref: `T${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`,
        company_id: input.companyId,
        user_id: input.user.id,
        subject: input.subject,
        body: input.body,
        category: input.category,
        product: input.product,
        priority: input.priority,
        status: "open",
        source: input.source,
        attachments: JSON.stringify(input.attachments ?? []),
        sla_due_at: slaDueAt(company?.tier, input.priority),
        last_activity_at: now,
    })) as Row;
    const ref = `AOS-${1000 + Number(ticket.id)}`;
    await Ticket.update(ticket.id, { ref });
    ticket.ref = ref;

    const who = input.user.name ?? "A client";
    const where = company ? ` (${company.name})` : "";
    await notifyStaff(
        { kind: "ticket", title: `New ticket ${ref}: ${input.subject}`, body: `${who}${where} · ${productName(input.product)} · ${input.priority}`, url: `/admin/tickets/${ticket.id}` },
        {
            subject: `[${ref}] ${input.subject}`,
            heading: `New ${input.priority} ticket from ${who}${where}`,
            intro: `${productName(input.product)} · ${input.category}`,
            quote: input.body.slice(0, 1500),
            actionUrl: `${APP_URL}/admin/tickets/${ticket.id}`,
            actionLabel: "Open ticket",
        },
        {
            except: input.createdByStaff?.id,
            sms: `New ${input.priority} ticket ${ref} from ${who}${where}: ${input.subject}. ${shortLink(`${APP_URL}/admin/tickets/${ticket.id}`)}`,
        },
    );

    // Raised by the client: a receipt by SMS (if they turned SMS on) with
    // the reference and the response target, so they know it landed.
    if (!input.createdByStaff) {
        const hours = Math.max(1, Math.round((new Date(String(ticket.sla_due_at)).getTime() - Date.now()) / 3600_000));
        smsUser(input.user, `We've received your ticket ${ref}: ${input.subject}. We aim to reply within ${hours}h. Track it: ${shortLink(`${APP_URL}/portal/tickets/${ticket.id}`)}`);
    }

    // Opened by staff on a client's behalf: tell the client.
    if (input.createdByStaff) {
        await notifyUser(
            input.user.id,
            { kind: "ticket", title: `We opened ${ref} for you`, body: input.subject, url: `/portal/tickets/${ticket.id}` },
            {
                email: {
                    subject: `[${ref}] ${input.subject}`,
                    heading: "We've opened a ticket for you",
                    intro: `${input.createdByStaff.name} from Ashmif opened ${ref} so we can track this together.`,
                    quote: input.body.slice(0, 1500),
                    actionUrl: `${APP_URL}/portal/tickets/${ticket.id}`,
                    actionLabel: "View ticket",
                },
                sms: `${input.createdByStaff.name} from Ashmif opened ticket ${ref} for you: ${input.subject}. ${shortLink(`${APP_URL}/portal/tickets/${ticket.id}`)}`,
            },
        );
    }
    return ticket;
}

// A reply from either side. Staff replies (not internal notes) count as
// the first response for the SLA and move the ticket to awaiting_client;
// a client reply reopens a resolved ticket.
export async function addReply(ticket: Row, author: Row, body: string, internal: boolean, attachments: StoredFile[]) {
    const reply = (await TicketReply.create({
        ticket_id: ticket.id,
        user_id: author.id,
        body,
        internal: internal ? 1 : 0,
        attachments: JSON.stringify(attachments),
    })) as Row;

    const now = nowIso();
    const fromStaff = isStaff(author);
    const changes: Row = { last_activity_at: now };

    if (fromStaff && !internal) {
        if (!ticket.first_response_at) changes.first_response_at = now;
        if (ticket.status === "open" || ticket.status === "in_progress") changes.status = "awaiting_client";
    }
    if (!fromStaff && ["awaiting_client", "resolved"].includes(ticket.status)) {
        changes.status = "open";
        changes.resolved_at = null;
    }
    await Ticket.update(ticket.id, changes);

    if (internal) return reply;

    if (fromStaff) {
        await notifyUser(
            ticket.user_id,
            { kind: "ticket", title: `New reply on ${ticket.ref}`, body: `${author.name}: ${body.slice(0, 140)}`, url: `/portal/tickets/${ticket.id}` },
            {
                email: {
                    subject: `Re: [${ticket.ref}] ${ticket.subject}`,
                    heading: `${author.name} replied to your ticket`,
                    intro: `${ticket.ref} · ${ticket.subject}`,
                    quote: body.slice(0, 2000),
                    actionUrl: `${APP_URL}/portal/tickets/${ticket.id}`,
                    actionLabel: "Reply in the portal",
                },
                sms: `${author.name} replied on your ticket ${ticket.ref}: "${snippet(body)}" Reply: ${shortLink(`${APP_URL}/portal/tickets/${ticket.id}`)}`,
            },
        );
    } else {
        const target = { kind: "ticket", title: `${author.name} replied on ${ticket.ref}`, body: body.slice(0, 140), url: `/admin/tickets/${ticket.id}` };
        const sms = `${author.name} replied on ${ticket.ref}: "${snippet(body)}" ${shortLink(`${APP_URL}/admin/tickets/${ticket.id}`)}`;
        if (ticket.assigned_to) {
            await notifyUser(ticket.assigned_to, target, {
                email: {
                    subject: `Re: [${ticket.ref}] ${ticket.subject}`,
                    heading: `${author.name} replied`,
                    intro: `${ticket.ref} · ${ticket.subject}`,
                    quote: body.slice(0, 2000),
                    actionUrl: `${APP_URL}/admin/tickets/${ticket.id}`,
                    actionLabel: "Open ticket",
                },
                sms,
            });
        } else {
            await notifyStaff(target, undefined, { sms });
        }
    }
    return reply;
}

// The first words of a reply, for a text message.
function snippet(body: string, max = 90): string {
    const flat = body.replace(/\s+/g, " ").trim();
    return flat.length > max ? flat.slice(0, max - 1) + "…" : flat;
}

export function presentTicket(t: Row, people: Record<number, Row> = {}, companyNames: Record<number, string> = {}) {
    const open = !["resolved", "closed"].includes(t.status);
    const due = t.sla_due_at ? new Date(t.sla_due_at).getTime() : null;
    return {
        id: t.id,
        ref: t.ref,
        subject: t.subject,
        body: t.body,
        category: t.category,
        product: t.product,
        product_name: productName(t.product),
        priority: t.priority,
        status: t.status,
        source: t.source,
        company_id: t.company_id,
        company_name: companyNames[t.company_id] ?? null,
        user_id: t.user_id,
        requester: people[t.user_id] ?? null,
        assigned_to: t.assigned_to,
        assignee: t.assigned_to ? people[t.assigned_to] ?? null : null,
        attachments: parseJson(t.attachments, []),
        sla_due_at: t.sla_due_at,
        sla_breached: Boolean(open && !t.first_response_at && due && due < Date.now()),
        first_response_at: t.first_response_at,
        resolved_at: t.resolved_at,
        last_activity_at: t.last_activity_at ?? t.updated_at,
        rating: t.rating,
        rating_comment: t.rating_comment,
        created_at: t.created_at,
    };
}

export async function presentTickets(rows: Row[]) {
    const people = await userDirectory(rows.flatMap((t) => [t.user_id, t.assigned_to]));
    const companyIds = [...new Set(rows.map((t) => t.company_id).filter(Boolean))];
    const companies = companyIds.length ? ((await Company.whereIn("id", companyIds).get()) as Row[]) : [];
    const names: Record<number, string> = {};
    for (const c of companies) names[c.id] = c.name;
    return rows.sort(byNewest("last_activity_at")).map((t) => presentTicket(t, people, names));
}

export async function ticketThread(ticket: Row, includeInternal: boolean) {
    let replies = (await TicketReply.where("ticket_id", ticket.id).orderBy("id", "ASC").get()) as Row[];
    if (!includeInternal) replies = replies.filter((r) => !r.internal);
    const people = await userDirectory([ticket.user_id, ticket.assigned_to, ...replies.map((r) => r.user_id)]);
    const company = ticket.company_id ? ((await Company.find(ticket.company_id)) as Row | null) : null;
    const names: Record<number, string> = company ? { [company.id]: company.name } : {};
    return {
        ticket: { ...presentTicket(ticket, people, names), company_tier: company?.tier ?? null },
        replies: replies.map((r) => ({
            id: r.id,
            body: r.body,
            internal: Boolean(r.internal),
            attachments: parseJson(r.attachments, []),
            author: people[r.user_id] ?? { id: r.user_id, name: "Unknown", role: "client" },
            from_staff: isStaff(people[r.user_id]),
            created_at: r.created_at,
        })),
    };
}

export async function requesterEmail(ticket: Row): Promise<string | null> {
    const u = (await User.find(ticket.user_id)) as Row | null;
    return u?.email ?? null;
}
