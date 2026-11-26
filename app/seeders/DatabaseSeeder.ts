/**
 * Sample data for local development: `npx tylix db:seed`.
 *
 * Creates (only if missing) an admin, a staff member and two client
 * companies with people, services, tickets, projects, invoices, a status
 * incident, an announcement and job openings. Every account's password is
 * DEV_PASSWORD below. Never run this against production.
 */
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import { Ticket } from "../models/Ticket.js";
import { TicketReply } from "../models/TicketReply.js";
import { SupportMessage } from "../models/SupportMessage.js";
import { Subscription } from "../models/Subscription.js";
import { Project } from "../models/Project.js";
import { ProjectUpdate } from "../models/ProjectUpdate.js";
import { BillingDocument } from "../models/BillingDocument.js";
import { Announcement } from "../models/Announcement.js";
import { Incident } from "../models/Incident.js";
import { JobOpening } from "../models/JobOpening.js";
import { Lead } from "../models/Lead.js";
import { totals } from "../services/billing.js";

const DEV_PASSWORD = "AshmifDev!2026";

type Row = Record<string, any>;
const day = 86400_000;
const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();
const dateOnly = (offsetDays: number) => new Date(Date.now() + offsetDays * day).toISOString().slice(0, 10);

async function person(name: string, email: string, role: string, companyId: number | null, extra: Row = {}) {
    let u = (await User.findByEmail(email)) as Row | null;
    if (!u) {
        u = (await User.create({ name, email, password: DEV_PASSWORD })) as Row;
        await User.markEmailVerified(u.id);
    }
    await User.update(u.id, { role, company_id: companyId, ...extra });
    return (await User.find(u.id)) as Row;
}

async function company(name: string, slug: string, fields: Row) {
    const existing = (await Company.where("slug", slug).first()) as Row | null;
    if (existing) return existing;
    return (await Company.create({ name, slug, ...fields })) as Row;
}

export async function seed() {
    const admin = await person("Mbaruk Ali", "admin@ashmif.test", "admin", null, { job_title: "Managing Director", phone: "+254758839829" });
    const staff = await person("Fatma Said", "support@ashmif.test", "staff", null, { job_title: "Support Lead" });

    const clinic = await company("Coastline Clinics", "coastline-clinics", { tier: "gold", status: "active", email: "accounts@coastline.test", phone: "+254711000111", address: "Nyali, Mombasa", kra_pin: "P051234567X", industry: "Healthcare", account_manager_id: staff.id });
    const school = await company("Bahari Academy", "bahari-academy", { tier: "silver", status: "active", email: "bursar@bahari.test", phone: "+254722000222", address: "Kilifi", industry: "Education", account_manager_id: admin.id });

    const amina = await person("Amina Odhiambo", "client@ashmif.test", "client", clinic.id, { job_title: "Operations Manager", phone: "+254711222333" });
    await person("Hassan Mwinyi", "hassan@coastline.test", "client", clinic.id, { job_title: "IT Officer" });
    const bursar = await person("Grace Wanjiru", "bursar@bahari.test", "client", school.id, { job_title: "Bursar" });

    if (((await Ticket.where("company_id", clinic.id).count()) as number) > 0) {
        console.log("Sample data already present; accounts refreshed.");
        return;
    }

    // Services
    await Subscription.create({ company_id: clinic.id, product: "medisynq", name: "MediSynq Hospital", kind: "subscription", plan: "Hospital", amount: 14999, cycle: "monthly", starts_on: dateOnly(-200), renews_on: dateOnly(9), status: "active", auto_renew: 1 });
    await Subscription.create({ company_id: clinic.id, product: "sms", name: "Sender ID: COASTLINE", kind: "sms", plan: "Sender ID", amount: 0, cycle: "yearly", starts_on: dateOnly(-300), renews_on: dateOnly(65), status: "active", reference: "COASTLINE" });
    await Subscription.create({ company_id: clinic.id, product: "website", name: "coastlineclinics.co.ke", kind: "domain", amount: 2500, cycle: "yearly", starts_on: dateOnly(-340), renews_on: dateOnly(25), status: "active" });
    await Subscription.create({ company_id: clinic.id, product: "hosting", name: "Business hosting + email (10 boxes)", kind: "hosting", amount: 18000, cycle: "yearly", starts_on: dateOnly(-100), renews_on: dateOnly(265), status: "active" });
    await Subscription.create({ company_id: school.id, product: "rekoncile", name: "Rekoncile for Bahari Academy", kind: "subscription", plan: "School", amount: 45000, cycle: "yearly", starts_on: dateOnly(-360), renews_on: dateOnly(5), status: "active" });

    // Tickets
    const mk = async (u: Row, c: Row, subject: string, body: string, product: string, priority: string, status: string, ageH: number, extra: Row = {}) => {
        const t = (await Ticket.create({
            ref: `T${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`, company_id: c.id, user_id: u.id, subject, body, category: "technical", product, priority, status, source: "portal",
            attachments: "[]", sla_due_at: iso(-ageH * 3600_000 + (c.tier === "gold" ? 8 : 24) * 3600_000), last_activity_at: iso(-ageH * 3600_000 / 2), ...extra,
        })) as Row;
        await Ticket.update(t.id, { ref: `AOS-${1000 + t.id}` });
        return t;
    };
    const t1 = await mk(amina, clinic, "Lab results not printing from the visit page", "Since this morning, clicking Print on lab results shows a blank page. Happens on all three reception PCs.", "medisynq", "high", "awaiting_client", 5, { assigned_to: staff.id, first_response_at: iso(-4.5 * 3600_000) });
    await TicketReply.create({ ticket_id: t1.id, user_id: staff.id, body: "Thanks Amina. We pushed a fix for the print layout. Could you refresh (Ctrl+Shift+R) and try again? Let us know if it still shows blank.", internal: 0, attachments: "[]" });
    await TicketReply.create({ ticket_id: t1.id, user_id: staff.id, body: "Caused by the new browser print preview. Patched in release 3.4.2.", internal: 1, attachments: "[]" });
    await mk(amina, clinic, "Add two new pharmacy users", "Please create accounts for our new pharmacists, Joy and Peter. Same rights as Mary.", "medisynq", "normal", "open", 2);
    await mk(bursar, school, "M-Pesa payments not matching admission numbers", "Parents are paying with the admission number but Rekoncile puts them in Needs review.", "rekoncile", "urgent", "open", 30);
    await mk(amina, clinic, "Website contact form emails", "Contact form messages from the website stopped arriving.", "website", "normal", "resolved", 240, { assigned_to: admin.id, first_response_at: iso(-238 * 3600_000), resolved_at: iso(-200 * 3600_000), rating: 5, rating_comment: "Quick and clear, thank you!" });

    // Quick messages
    await SupportMessage.create({ client_id: amina.id, company_id: clinic.id, author_id: amina.id, direction: "in", body: "Hi, is there a way to export this month's SHA claims to Excel?", page_url: "/portal" });
    await SupportMessage.create({ client_id: amina.id, company_id: clinic.id, author_id: staff.id, direction: "out", body: "Yes! In MediSynq go to Billing → Claims, filter by month and click Export. I can walk you through it if you like.", read_at: iso(-3600_000) });
    await SupportMessage.create({ client_id: bursar.id, company_id: school.id, author_id: bursar.id, direction: "in", body: "Can we get a call today about the matching problem? Fees deadline is Friday.", page_url: "/portal/tickets" });

    // Projects
    const p = (await Project.create({
        company_id: clinic.id, title: "Patient app, phase 2", description: "Appointment booking, lab results and M-Pesa payments in the Coastline patient app.", status: "in_progress", priority: "high", progress: 68,
        starts_on: dateOnly(-60), due_on: dateOnly(30), lead_id: admin.id,
        milestones: JSON.stringify([{ title: "Design sign-off", done: true, due_on: dateOnly(-45) }, { title: "Booking and reminders", done: true, due_on: dateOnly(-15) }, { title: "Lab results", done: false, due_on: dateOnly(10) }, { title: "M-Pesa checkout", done: false, due_on: dateOnly(25) }]),
    })) as Row;
    await ProjectUpdate.create({ project_id: p.id, user_id: admin.id, body: "Booking and SMS reminders are live in the test app. Lab results screen is next.", progress: 68, status: "in_progress" });
    await ProjectUpdate.create({ project_id: p.id, user_id: admin.id, body: "Design signed off. Thanks for the quick feedback!", progress: 25, status: "in_progress" });

    // Billing
    const items1 = [{ description: "MediSynq Hospital plan (monthly)", qty: 1, unit_price: 14999, taxable: true }, { description: "On-site training, half day", qty: 1, unit_price: 8000, taxable: true }];
    await BillingDocument.create({ kind: "invoice", number: "INV-2026-0001", company_id: clinic.id, subject: "MediSynq November", status: "sent", issued_on: dateOnly(-10), due_on: dateOnly(4), currency: "KES", vat_rate: 16, items: JSON.stringify(items1), ...totals(items1, 16), amount_paid: 0, created_by: admin.id });
    const items2 = [{ description: "Rekoncile annual licence", qty: 1, unit_price: 45000, taxable: true }];
    await BillingDocument.create({ kind: "invoice", number: "INV-2026-0002", company_id: school.id, subject: "Rekoncile renewal", status: "sent", issued_on: dateOnly(-40), due_on: dateOnly(-10), currency: "KES", vat_rate: 16, items: JSON.stringify(items2), ...totals(items2, 16), amount_paid: 0, created_by: admin.id });
    const items3 = [{ description: "Domain renewal coastlineclinics.co.ke", qty: 1, unit_price: 2500, taxable: false }];
    await BillingDocument.create({ kind: "invoice", number: "INV-2026-0003", company_id: clinic.id, subject: "Domain renewal", status: "paid", issued_on: dateOnly(-60), due_on: dateOnly(-46), currency: "KES", vat_rate: 16, items: JSON.stringify(items3), ...totals(items3, 16), amount_paid: 2500, paid_at: iso(-50 * day), payment_method: "mpesa", payment_ref: "SKL4XY12ZQ", receipt_number: "RCT-2026-0001", created_by: admin.id });
    const items4 = [{ description: "Patient app: lab results module", qty: 1, unit_price: 120000, taxable: true }, { description: "Patient app: M-Pesa checkout", qty: 1, unit_price: 85000, taxable: true }];
    await BillingDocument.create({ kind: "quote", number: "QUO-2026-0001", company_id: clinic.id, subject: "Patient app phase 3", status: "sent", issued_on: dateOnly(-3), due_on: dateOnly(27), currency: "KES", vat_rate: 16, items: JSON.stringify(items4), ...totals(items4, 16), amount_paid: 0, created_by: admin.id });

    // Status, news, careers, leads
    await Incident.create({ product: "sms", title: "Delayed delivery reports on one network", body: "Messages are sending normally; delivery reports are arriving late.", impact: "minor", status: "monitoring", started_at: iso(-3 * 3600_000) });
    await Incident.create({ product: "medisynq", title: "Scheduled database upgrade", impact: "maintenance", status: "resolved", started_at: iso(-4 * day), resolved_at: iso(-4 * day + 3600_000) });
    await Announcement.create({ title: "New: pay invoices by M-Pesa and tell us in one tap", body: "Open any invoice in Billing, pay through Paybill, then press “I've paid” with your M-Pesa code. We'll confirm and send your receipt.", level: "new", audience: "clients", published: 1 });
    await JobOpening.create({ title: "Full-stack developer (TypeScript)", department: "engineering", location: "Mombasa, Kenya · hybrid", employment: "full_time", summary: "Build and run MediSynq, Rekoncile and Payroflix features end to end.", description: "You'll work across our products: design APIs, build screens, and ship to production every week. You'll talk to customers, fix what matters to them and help shape how we build.", requirements: "2+ years building web apps in TypeScript or JavaScript\nComfortable with SQL databases\nYou care about the people who use your software", status: "open" });
    await JobOpening.create({ title: "Customer support specialist", department: "support", location: "Mombasa, Kenya", employment: "full_time", summary: "Be the first voice our clients hear, and get them unstuck fast.", description: "Answer tickets and messages, onboard new clients and turn what you hear into improvements for the product team.", requirements: "Excellent written English and Swahili\nPatience and curiosity\nBonus: experience with school, clinic or payroll software", status: "open" });
    await Lead.create({ name: "Omar Bakari", email: "omar@example.com", phone: "+254733000444", company: "Pwani Freight Ltd", topic: "sales", product: "smartfreight", message: "We consolidate containers from Dubai and need manifests and bills of lading. Can we get a demo next week?", status: "new" });

    console.log(`Seeded. Sign in with admin@ashmif.test, support@ashmif.test or client@ashmif.test, password ${DEV_PASSWORD}`);
}
