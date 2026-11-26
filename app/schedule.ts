/**
 * Scheduled work, run by `npx tylix schedule:work`.
 *
 * - Every 15 minutes: tickets that missed their first-response target are
 *   escalated to staff once (in-app + support inbox email).
 * - Every morning at 08:00 EAT: renewal reminders 30, 14, 7 and 1 days before
 *   a service renews (to the client's team and to staff), and overdue
 *   invoice reminders on the 1st, 7th and 14th day overdue.
 */
import type { Scheduler } from "@tylix/core";
import { Ticket } from "./models/Ticket.js";
import { Subscription } from "./models/Subscription.js";
import { BillingDocument } from "./models/BillingDocument.js";
import { Company } from "./models/Company.js";
import { cache } from "@tylix/core";
import { APP_URL, money, notifyCompany, notifyStaff, type Row } from "./services/portal.js";

const RENEWAL_DAYS = [30, 14, 7, 1];
const OVERDUE_DAYS = [1, 7, 14];

function daysFrom(date: unknown): number {
    const d = new Date(String(date));
    const today = new Date(new Date().toISOString().slice(0, 10));
    return Math.round((new Date(d.toISOString().slice(0, 10)).getTime() - today.getTime()) / 86400_000);
}

// Each reminder is sent once: the cache remembers what went out.
async function once(key: string, seconds: number): Promise<boolean> {
    if (await cache.get(key)) return false;
    await cache.set(key, 1, seconds);
    return true;
}

export async function escalateBreaches() {
    const open = ((await Ticket.all()) as Row[]).filter((t) => !["resolved", "closed"].includes(t.status) && !t.first_response_at && t.sla_due_at);
    for (const t of open) {
        if (new Date(t.sla_due_at).getTime() > Date.now()) continue;
        if (!(await once(`sla-breach:${t.id}`, 30 * 86400))) continue;
        const company = t.company_id ? ((await Company.find(t.company_id)) as Row | null) : null;
        await notifyStaff(
            { kind: "ticket", title: `SLA breached: ${t.ref}`, body: `${t.subject}${company ? " · " + company.name + " (" + company.tier + ")" : ""}`, url: `/admin/tickets/${t.id}` },
            {
                subject: `[SLA breached] ${t.ref} ${t.subject}`,
                heading: `${t.ref} missed its response target`,
                intro: `${company ? company.name + " · " + company.tier + " tier · " : ""}${t.priority} priority. Nobody has replied yet.`,
                actionUrl: `${APP_URL}/admin/tickets/${t.id}`,
                actionLabel: "Reply now",
            },
        );
    }
}

export async function sendReminders() {
    for (const s of (await Subscription.where("status", "active").get()) as Row[]) {
        if (!s.renews_on) continue;
        const days = daysFrom(s.renews_on);
        if (!RENEWAL_DAYS.includes(days)) continue;
        if (!(await once(`renewal:${s.id}:${s.renews_on}:${days}`, 40 * 86400))) continue;
        const when = days === 1 ? "tomorrow" : `in ${days} days`;
        await notifyCompany(
            s.company_id,
            { kind: "billing", title: `${s.name} renews ${when}`, body: s.auto_renew ? "It renews automatically." : "Request a renewal from Services to avoid interruption.", url: "/portal/services" },
            {
                email: {
                    subject: `${s.name} renews ${when}`,
                    heading: `${s.name} renews ${when}`,
                    intro: s.auto_renew ? "This service renews automatically; no action needed." : "To keep it running without interruption, request the renewal from your portal and we'll send the invoice.",
                    lines: [`Renewal date: ${String(s.renews_on).slice(0, 10)}`, s.amount ? `Price: ${money(s.amount, s.currency)} (${s.cycle})` : ""].filter(Boolean),
                    actionUrl: `${APP_URL}/portal/services`,
                    actionLabel: "Open services",
                },
            },
        );
        await notifyStaff({ kind: "billing", title: `Renewal ${when}: ${s.name}`, body: `Company #${s.company_id}`, url: "/admin/services" });
    }

    for (const d of (await BillingDocument.where("kind", "invoice").get()) as Row[]) {
        if (!["sent", "partial"].includes(d.status) || !d.due_on) continue;
        const overdue = -daysFrom(d.due_on);
        if (!OVERDUE_DAYS.includes(overdue)) continue;
        if (!(await once(`overdue:${d.id}:${overdue}`, 40 * 86400))) continue;
        const balance = Number(d.total) - Number(d.amount_paid);
        await notifyCompany(
            d.company_id,
            { kind: "billing", title: `${d.number} is overdue`, body: `${money(balance, d.currency)} outstanding`, url: `/portal/billing/${d.id}` },
            {
                email: {
                    subject: `Reminder: ${d.number} is overdue`,
                    heading: `${d.number} is ${overdue} day${overdue === 1 ? "" : "s"} overdue`,
                    intro: `${money(balance, d.currency)} is outstanding. If you've already paid, tell us with the M-Pesa code from the invoice page and we'll confirm.`,
                    actionUrl: `${APP_URL}/portal/billing/${d.id}`,
                    actionLabel: "View invoice",
                },
            },
        );
    }
}

export async function schedule(scheduler: Scheduler) {
    scheduler.every("15m", escalateBreaches);
    // The app runs in UTC (see tylix.config.ts): 05:00 UTC is 08:00 in Nairobi.
    scheduler.daily("05:00", sendReminders);
}
