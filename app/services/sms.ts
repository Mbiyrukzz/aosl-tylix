/**
 * Text messages through the Ashmif SMS API (v3):
 *   POST {ASHMIF_SMS_URL}/sms/send  Bearer ASHMIF_SMS_TOKEN
 *   { recipient, sender_id, type: "plain", message }
 *
 * SMS_DRIVER=log (the default) only prints the message, like MAIL_DRIVER=log,
 * so development never spends credit. SMS_DRIVER=ashmif sends for real.
 *
 * sendSms never throws and never waits on the network for its caller: an SMS
 * problem must not fail the request that triggered it.
 */

const DRIVER = (process.env.SMS_DRIVER ?? "log").toLowerCase();
const BASE = (process.env.ASHMIF_SMS_URL ?? "https://sms.ashmif.com/api/v3").replace(/\/+$/, "");
const TOKEN = process.env.ASHMIF_SMS_TOKEN ?? "";
const SENDER = process.env.ASHMIF_SMS_SENDER_ID ?? "ASHMIF";

// A long message is split into several billed parts; keep notices to two.
const MAX_LENGTH = 306;

/**
 * Kenyan numbers in the 2547XXXXXXXX / 2541XXXXXXXX form the API expects.
 * Accepts 07…, 01…, 7…, 1…, +254… and 254… with spaces or dashes.
 * Returns null for anything it can't read with confidence.
 */
export function normalizePhone(raw: unknown): string | null {
    const digits = String(raw ?? "").replace(/\D/g, "");
    if (digits.startsWith("254") && digits.length === 12) return digits;
    if (digits.startsWith("0") && digits.length === 10) return `254${digits.slice(1)}`;
    if (digits.length === 9 && /^[71]/.test(digits)) return `254${digits}`;
    return null;
}

/** Numbers listed in SUPPORT_SMS (comma separated): the on-call phones. */
export function supportNumbers(): string[] {
    return (process.env.SUPPORT_SMS ?? "")
        .split(",")
        .map(normalizePhone)
        .filter((n): n is string => n !== null);
}

export function smsEnabled(): boolean {
    return DRIVER === "log" || (DRIVER === "ashmif" && TOKEN !== "");
}

// Shortens a long message, keeping a trailing link intact (the text before
// it is cut instead).
function clip(message: string): string {
    const flat = message.replace(/\s+/g, " ").trim();
    if (flat.length <= MAX_LENGTH) return flat;
    const m = /\s(\S+\/\S*)$/.exec(flat);
    const link = m && m[1].length < 80 ? m[1] : "";
    const room = MAX_LENGTH - (link ? link.length + 1 : 0) - 1;
    return flat.slice(0, room).trimEnd() + "…" + (link ? " " + link : "");
}

let warnedMissingToken = false;

async function deliver(recipients: string[], message: string): Promise<void> {
    if (DRIVER === "log") {
        console.info(`[sms:log] to ${recipients.join(",")}: ${message}`);
        return;
    }
    if (DRIVER !== "ashmif") return;
    if (!TOKEN) {
        if (!warnedMissingToken) console.warn("[sms] SMS_DRIVER=ashmif but ASHMIF_SMS_TOKEN is empty; no SMS sent.");
        warnedMissingToken = true;
        return;
    }
    try {
        const res = await fetch(`${BASE}/sms/send`, {
            method: "POST",
            headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json", Accept: "application/json" },
            // The API takes several recipients as one comma-separated string.
            body: JSON.stringify({ recipient: recipients.join(","), sender_id: SENDER, type: "plain", message }),
            signal: AbortSignal.timeout(10_000),
        });
        const data = (await res.json().catch(() => ({}))) as { status?: string; message?: string };
        if (!res.ok || data.status !== "success") {
            console.error(`[sms] send failed (${res.status}): ${data.message ?? "no message"}`);
        }
    } catch (err) {
        console.error("[sms] request error:", err instanceof Error ? err.message : err);
    }
}

/** Sends one message to one or more numbers. Bad numbers are dropped. */
export function sendSms(to: unknown | unknown[], message: string): void {
    const list = (Array.isArray(to) ? to : [to]).map(normalizePhone).filter((n): n is string => n !== null);
    const recipients = [...new Set(list)];
    if (recipients.length === 0 || !message.trim()) return;
    void deliver(recipients, clip(message));
}

/** A user's number, if they have one and turned SMS on in Settings. */
export function smsNumberFor(user: Record<string, any> | null | undefined): string | null {
    if (!user) return null;
    if (user.notify_sms !== 1 && user.notify_sms !== true) return null;
    return normalizePhone(user.phone);
}

/** "ashmif.com/portal/tickets/4" from a full URL: shorter, still tappable. */
export function shortLink(url: string): string {
    return url.replace(/^https?:\/\//, "");
}
