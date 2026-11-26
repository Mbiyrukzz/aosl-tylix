/**
 * Shared server logic for the AOS client portal and staff console:
 * who is asking (and what they may see), SLA targets, in-app
 * notifications and the branded notice email.
 */
import { loadConfig } from "@tylix/shared";
import type { TylixRequest, TylixResponse } from "@tylix/core";
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import { Notification } from "../models/Notification.js";
import { NoticeMail, type NoticeData } from "../mail/NoticeMail.js";
import { sendSms, smsNumberFor, supportNumbers } from "./sms.js";

export type Row = Record<string, any>;

export const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const SUPPORT_INBOX = process.env.SUPPORT_INBOX ?? "hello@ashmif.com";

export const STAFF_ROLES = ["staff", "admin"];

export function isStaff(user: Row | null | undefined): boolean {
    return Boolean(user && STAFF_ROLES.includes(String(user.role)));
}

export function safeUser(user: Row | null | undefined) {
    if (!user) return null;
    const { password: _p, ...rest } = user;
    return rest;
}

// Loads the signed-in user's row. Every guarded handler starts here.
export async function viewer(req: TylixRequest): Promise<Row | null> {
    const id = req.user?.userId;
    if (!id) return null;
    return (await User.find(id as number)) as Row | null;
}

// Staff and admins only. Sends the 403 itself and returns null.
export async function staffOnly(req: TylixRequest, res: TylixResponse): Promise<Row | null> {
    const user = await viewer(req);
    if (!isStaff(user)) {
        res.status(403).json({ error: "This area is for Ashmif staff." });
        return null;
    }
    return user;
}

export async function adminOnly(req: TylixRequest, res: TylixResponse): Promise<Row | null> {
    const user = await viewer(req);
    if (!user || user.role !== "admin") {
        res.status(403).json({ error: "Only an administrator can do that." });
        return null;
    }
    return user;
}

// A client with a company. Staff may call client endpoints too (they get
// an empty portal), but a client without a company is refused.
export async function clientOnly(req: TylixRequest, res: TylixResponse): Promise<Row | null> {
    const user = await viewer(req);
    if (!user) {
        res.status(401).json({ error: "Not signed in." });
        return null;
    }
    if (!isStaff(user) && !user.company_id) {
        res.status(403).json({ error: "Your account isn't linked to a company yet. Message support and we'll sort it out." });
        return null;
    }
    return user;
}

// ── Small value helpers ─────────────────────────────────────────────

export function parseJson<T>(value: unknown, fallback: T): T {
    if (value == null || value === "") return fallback;
    if (typeof value !== "string") return value as T;
    try {
        return JSON.parse(value) as T;
    } catch {
        return fallback;
    }
}

export function text(value: unknown, max = 5000): string {
    return String(value ?? "").trim().slice(0, max);
}

export function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
    return allowed.includes(value as T) ? (value as T) : fallback;
}

export function num(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

export function dateOnly(value: unknown): string | null {
    if (!value) return null;
    const d = new Date(String(value));
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString().slice(0, 10);
}

export function nowIso(): string {
    return new Date().toISOString().replace(/\.\d{3}Z$/, ".000Z");
}

export function byNewest(field = "created_at") {
    return (a: Row, b: Row) => new Date(b[field] ?? 0).getTime() - new Date(a[field] ?? 0).getTime();
}

export function money(amount: unknown, currency = "KES"): string {
    return `${currency} ${num(amount).toLocaleString("en-KE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export async function companyName(id: unknown): Promise<string> {
    if (!id) return "";
    const c = (await Company.find(Number(id))) as Row | null;
    return c?.name ?? "";
}

// Names for a set of user ids, in one pass. Used to label replies.
export async function userDirectory(ids: unknown[]): Promise<Record<number, Row>> {
    const unique = [...new Set(ids.filter(Boolean).map(Number))];
    const out: Record<number, Row> = {};
    if (unique.length === 0) return out;
    const rows = (await User.whereIn("id", unique).get()) as Row[];
    for (const u of rows) {
        out[u.id] = { id: u.id, name: u.name, role: u.role, avatar_url: u.avatar_url ?? null, job_title: u.job_title ?? null };
    }
    return out;
}

// ── SLA ─────────────────────────────────────────────────────────────

// First-response targets, in hours, by support tier. Priority scales it.
export const SLA_HOURS: Record<string, number> = { platinum: 2, gold: 8, silver: 24 };
const PRIORITY_FACTOR: Record<string, number> = { urgent: 0.5, high: 0.75, normal: 1, low: 2 };

export function slaDueAt(tier: string | null | undefined, priority: string): string {
    const hours = (SLA_HOURS[String(tier)] ?? 24) * (PRIORITY_FACTOR[priority] ?? 1);
    return new Date(Date.now() + hours * 3600_000).toISOString();
}

// ── Notifications and mail ──────────────────────────────────────────

let mailConfigPromise: Promise<unknown> | null = null;
function mailConfig() {
    mailConfigPromise ??= loadConfig(process.cwd(), "typescript").then((c: Row) => c.mail);
    return mailConfigPromise;
}

// Sends a branded notice. Never throws: a mail problem must not fail the
// request that triggered it.
export function sendNotice(to: string | null | undefined, data: NoticeData): void {
    if (!to) return;
    mailConfig()
        .then((config) => new NoticeMail(data).send(to, config as never))
        .catch((err: unknown) => console.error("[mail] notice failed:", err));
}

export interface NotifyInput {
    kind: string;
    title: string;
    body?: string;
    url?: string;
}

export interface NotifyOptions {
    email?: NoticeData | false;
    // Text message for people who turned SMS on in Settings and have a
    // phone number. Keep it short: link + one line.
    sms?: string | false;
}

export async function notifyUser(userId: number, input: NotifyInput, options: NotifyOptions = {}) {
    await Notification.create({
        user_id: userId,
        kind: input.kind,
        title: text(input.title, 200),
        body: text(input.body ?? "", 2000),
        url: input.url ?? null,
    });
    if (!options.email && !options.sms) return;
    const user = (await User.find(userId)) as Row | null;
    if (!user) return;
    if (options.email && user.notify_email !== 0 && user.notify_email !== false) {
        sendNotice(user.email, options.email);
    }
    if (options.sms) {
        const phone = smsNumberFor(user);
        if (phone) sendSms(phone, options.sms);
    }
}

// Everyone at a client company (e.g. a project update).
export async function notifyCompany(companyId: number, input: NotifyInput, options: NotifyOptions & { except?: number } = {}) {
    const people = (await User.where("company_id", companyId).get()) as Row[];
    for (const p of people) {
        if (p.id === options.except || isStaff(p)) continue;
        await notifyUser(p.id, input, { email: options.email, sms: options.sms });
    }
}

// Every staff member gets the in-app notification; the shared support
// inbox gets the email once. With options.sms, staff who turned SMS on
// and the on-call numbers in SUPPORT_SMS get a text (one per number).
export async function notifyStaff(input: NotifyInput, email?: NoticeData, options: { except?: number; sms?: string | false } = {}) {
    const staff = (await User.whereIn("role", STAFF_ROLES).get()) as Row[];
    const phones: string[] = [];
    for (const s of staff) {
        if (s.id === options.except) continue;
        await Notification.create({
            user_id: s.id,
            kind: input.kind,
            title: text(input.title, 200),
            body: text(input.body ?? "", 2000),
            url: input.url ?? null,
        });
        const phone = smsNumberFor(s);
        if (phone) phones.push(phone);
    }
    if (email) sendNotice(SUPPORT_INBOX, email);
    if (options.sms) sendSms([...phones, ...supportNumbers()], options.sms);
}

// A one-off text to a single person (no in-app notification), only if
// they turned SMS on. Used for receipts like "we got your ticket".
export function smsUser(user: Row | null | undefined, message: string): void {
    const phone = smsNumberFor(user);
    if (phone) sendSms(phone, message);
}
