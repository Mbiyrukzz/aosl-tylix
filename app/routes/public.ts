import type { Router, TylixRequest, TylixResponse } from "@tylix/core";
import { createRateLimiter } from "@tylix/core";
import { Lead } from "../models/Lead.js";
import { Incident } from "../models/Incident.js";
import { JobOpening } from "../models/JobOpening.js";
import { JobApplication } from "../models/JobApplication.js";
import { PRODUCTS, PRODUCT_SLUGS, productName } from "../services/catalog.js";
import { storeDataUrl } from "../services/files.js";
import { type Row, APP_URL, byNewest, notifyStaff, oneOf, sendNotice, text } from "../services/portal.js";
import { startHubReporting } from "../services/hub.js";

const formLimiter = createRateLimiter({ name: "public-forms", max: 8, windowMs: 15 * 60 * 1000, store: "shared" });
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

function ip(req: TylixRequest): string {
    return String((req as Row).ip ?? req.headers?.["x-forwarded-for"] ?? "unknown");
}

async function limited(req: TylixRequest, res: TylixResponse): Promise<boolean> {
    const result = await formLimiter(ip(req));
    if (!result.allowed) {
        res.status(429).json({ error: "Too many submissions. Please wait a few minutes and try again." });
        return true;
    }
    return false;
}

const ACTIVE = ["investigating", "identified", "monitoring"];

export async function routes(router: Router) {
    // Heartbeat and user numbers to the Ashmif Hub (no-op until HUB_URL
    // and HUB_API_KEY are set). Guarded inside, so a second call is harmless.
    startHubReporting(process.env.npm_package_version ?? "0.1.0");

    // Live status of every product, plus the last 14 days of incidents.
    router.get("/api/public/status", async (_req, res) => {
        const since = Date.now() - 14 * 86400_000;
        const rows = ((await Incident.all()) as Row[]).sort(byNewest("started_at"));
        const recent = rows.filter((i) => ACTIVE.includes(i.status) || new Date(i.started_at ?? i.created_at).getTime() > since);
        const products = PRODUCTS.map((p) => {
            const open = rows.filter((i) => i.product === p.slug && ACTIVE.includes(i.status));
            let state = "operational";
            if (open.some((i) => i.impact === "major")) state = "outage";
            else if (open.some((i) => i.impact === "minor")) state = "degraded";
            else if (open.some((i) => i.impact === "maintenance")) state = "maintenance";
            return { slug: p.slug, name: p.name, url: p.url, state };
        });
        return res.json({
            products,
            incidents: recent.map((i) => ({ ...i, product_name: productName(i.product), active: ACTIVE.includes(i.status) })),
            checked_at: new Date().toISOString(),
        });
    });

    router.post("/api/public/contact", async (req, res) => {
        if (await limited(req, res)) return;
        const b = req.body ?? {};
        const errors: Record<string, string[]> = {};
        const name = text(b.name, 120);
        const email = text(b.email, 200).toLowerCase();
        const message = text(b.message, 5000);
        if (!name) errors.name = ["Tell us your name."];
        if (!EMAIL_RE.test(email)) errors.email = ["Enter a valid email address."];
        if (message.length < 10) errors.message = ["A few more words, please (10 characters at least)."];
        if (Object.keys(errors).length) return res.status(422).json({ errors });

        const topic = oneOf(b.topic, ["general", "sales", "project", "sms", "email", "support", "partnership"] as const, "general");
        const product = PRODUCT_SLUGS.includes(b.product) ? b.product : null;
        const lead = (await Lead.create({ name, email, phone: text(b.phone, 40), company: text(b.company, 200), topic, product, message, status: "new" })) as Row;

        await notifyStaff(
            { kind: "lead", title: `New enquiry from ${name}`, body: `${topic}${product ? " · " + productName(product) : ""}: ${message.slice(0, 120)}`, url: `/admin/leads?id=${lead.id}` },
            {
                subject: `New enquiry: ${name}${b.company ? " · " + text(b.company, 80) : ""}`,
                heading: `${name} got in touch`,
                intro: `${topic}${product ? " · " + productName(product) : ""} · ${email}${b.phone ? " · " + text(b.phone, 40) : ""}`,
                quote: message,
                actionUrl: `${APP_URL}/admin/leads`,
                actionLabel: "Open leads",
            },
        );
        sendNotice(email, {
            subject: "We've got your message",
            heading: `Thanks, ${name.split(" ")[0]}`,
            intro: "Your message reached the Ashmif Office Solutions team. We reply within one business day, usually much sooner.",
            quote: message,
            footnote: "You're receiving this because you contacted us at ashmif.com.",
        });
        return res.status(201).json({ ok: true });
    });

    router.get("/api/public/careers", async (_req, res) => {
        const rows = ((await JobOpening.where("status", "open").get()) as Row[]).sort(byNewest());
        return res.json(rows.map(({ description: _d, requirements: _r, ...rest }) => rest));
    });

    router.get("/api/public/careers/:id", async (req, res) => {
        const job = (await JobOpening.find(req.params.id)) as Row | null;
        if (!job || job.status !== "open") return res.status(404).json({ error: "That role isn't open any more." });
        return res.json(job);
    });

    router.post("/api/public/careers/apply", async (req, res) => {
        if (await limited(req, res)) return;
        const b = req.body ?? {};
        const errors: Record<string, string[]> = {};
        const name = text(b.name, 120);
        const email = text(b.email, 200).toLowerCase();
        if (!name) errors.name = ["Tell us your name."];
        if (!EMAIL_RE.test(email)) errors.email = ["Enter a valid email address."];
        if (!b.cv) errors.cv = ["Attach your CV (PDF or Word)."];
        let opening: Row | null = null;
        if (b.opening_id) {
            opening = (await JobOpening.find(Number(b.opening_id))) as Row | null;
            if (!opening || opening.status !== "open") errors.opening_id = ["That role isn't open any more."];
        }
        if (Object.keys(errors).length) return res.status(422).json({ errors });

        const stored = await storeDataUrl(b.cv, b.cv_name, [
            "application/pdf",
            "application/msword",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ]);
        if ("error" in stored) return res.status(422).json({ errors: { cv: [stored.error] } });

        await JobApplication.create({
            opening_id: opening?.id ?? null,
            name,
            email,
            phone: text(b.phone, 40),
            portfolio: text(b.portfolio, 250),
            cover_letter: text(b.cover_letter, 5000),
            cv_url: stored.url,
            cv_name: stored.name,
            status: "new",
        });
        const role = opening?.title ?? "General application";
        await notifyStaff({ kind: "career", title: `New application: ${role}`, body: `${name} · ${email}`, url: "/admin/careers" });
        sendNotice(email, {
            subject: `Application received: ${role}`,
            heading: `Thanks for applying, ${name.split(" ")[0]}`,
            intro: `We've received your application for ${role}. Our team reads every one and will contact you if there's a fit.`,
            footnote: "You're receiving this because you applied for a role at Ashmif Office Solutions.",
        });
        return res.status(201).json({ ok: true });
    });
}
