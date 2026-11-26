/**
 * Reports this app to the Ashmif Hub (HUB_URL), the same way Tylix Deploy
 * does, so AOS shows up there with uptime and user numbers:
 *
 *   POST /api/v1/ingest/heartbeat  every minute       { version }
 *   POST /api/v1/ingest/metrics    every ten minutes  users + companies
 *
 * Authenticated with the product API key the Hub shows once when you add
 * the product (HUB_API_KEY). Fire-and-forget: a Hub outage never slows or
 * breaks a request. Nothing runs until HUB_URL and HUB_API_KEY are set.
 */
import { User } from "../models/User.js";
import { Company } from "../models/Company.js";
import { AuthSession } from "../models/AuthSession.js";

const BASE = (process.env.HUB_URL ?? "").replace(/\/+$/, "");
const KEY = process.env.HUB_API_KEY ?? "";
const ACTIVE_DAYS = 30;

type Row = Record<string, any>;

// One warning per path until it works again, so a wrong key or URL shows
// up in the log without flooding it every minute.
const warned = new Set<string>();

async function post(path: string, body: Record<string, unknown>): Promise<void> {
    if (!BASE || !KEY) return;
    try {
        const res = await fetch(BASE + path, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${KEY}` },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
            warned.delete(path);
        } else if (!warned.has(path)) {
            warned.add(path);
            console.warn(`[hub] ${path} answered ${res.status}. Check HUB_URL and HUB_API_KEY.`);
        }
    } catch {
        // Swallowed on purpose: the Hub being down is the Hub's problem.
    }
}

function ms(value: unknown): number {
    if (value instanceof Date) return value.getTime();
    return new Date(String(value ?? "")).getTime();
}

/**
 * users: every account; active = signed in or used a session in the last
 * 30 days. Tenants are client companies; a company is active when one of
 * its people was.
 */
async function collect() {
    const since = Date.now() - ACTIVE_DAYS * 86400_000;
    const users = (await User.all()) as Row[];
    const byId = new Map<number, Row>(users.map((u) => [Number(u.id), u]));

    const active = new Set<number>();
    for (const u of users) if (ms(u.last_seen_at) >= since) active.add(Number(u.id));
    for (const s of (await AuthSession.query().get()) as Row[]) {
        const id = Number(s.user_id);
        if (byId.has(id) && Math.max(ms(s.last_used_at), ms(s.created_at)) >= since) active.add(id);
    }

    const companies = (await Company.all()) as Row[];
    const activeCompanies = new Set<number>();
    for (const id of active) {
        const cid = byId.get(id)?.company_id;
        if (cid) activeCompanies.add(Number(cid));
    }

    return {
        users_total: users.length,
        users_active: active.size,
        active_days: ACTIVE_DAYS,
        tenants_total: companies.length,
        tenants_active: companies.filter((c) => activeCompanies.has(Number(c.id))).length,
        tenant_label: "Companies",
    };
}

let started = false;

/** Starts the heartbeat and metrics timers once per process. */
export function startHubReporting(version: string): void {
    if (started || !BASE || !KEY) return;
    started = true;

    const beat = () => void post("/api/v1/ingest/heartbeat", { version });
    beat();
    setInterval(beat, 60_000).unref();

    const metrics = async () => {
        try {
            await post("/api/v1/ingest/metrics", await collect());
        } catch (err) {
            console.error("[hub] metrics could not be collected:", err);
        }
    };
    // First count after a short delay so boot isn't slowed down.
    setTimeout(() => void metrics(), 30_000).unref();
    setInterval(() => void metrics(), 10 * 60_000).unref();
}
