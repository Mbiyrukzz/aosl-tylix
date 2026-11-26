import { BillingDocument } from "../models/BillingDocument.js";
import { type Row, num, parseJson, text } from "./portal.js";

export interface LineItem {
    description: string;
    qty: number;
    unit_price: number;
    taxable: boolean;
}

export function cleanItems(value: unknown): LineItem[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((i) => ({
            description: text(i?.description, 500),
            qty: Math.max(0, num(i?.qty, 1)),
            unit_price: Math.max(0, num(i?.unit_price, 0)),
            taxable: i?.taxable !== false,
        }))
        .filter((i) => i.description)
        .slice(0, 50);
}

const round = (n: number) => Math.round(n * 100) / 100;

export function totals(items: LineItem[], vatRate: number) {
    let subtotal = 0;
    let taxable = 0;
    for (const i of items) {
        const line = i.qty * i.unit_price;
        subtotal += line;
        if (i.taxable) taxable += line;
    }
    const vat = (taxable * vatRate) / 100;
    return { subtotal: round(subtotal), vat: round(vat), total: round(subtotal + vat) };
}

// INV-2026-0007, QUO-2026-0012, RCT-2026-0003: counted per year and kind.
export async function nextNumber(prefix: "INV" | "QUO" | "RCT"): Promise<string> {
    const year = new Date().getFullYear();
    const rows = (await BillingDocument.all()) as Row[];
    const field = prefix === "RCT" ? "receipt_number" : "number";
    const tag = `${prefix}-${year}-`;
    let max = 0;
    for (const r of rows) {
        const v = String(r[field] ?? "");
        if (v.startsWith(tag)) max = Math.max(max, Number(v.slice(tag.length)) || 0);
    }
    return `${tag}${String(max + 1).padStart(4, "0")}`;
}

export function isOverdue(d: Row): boolean {
    return d.kind === "invoice" && ["sent", "partial"].includes(d.status) && Boolean(d.due_on) && new Date(d.due_on).getTime() < Date.now() - 86400_000;
}

export function presentDoc(d: Row, companyName = ""): Row {
    const total = num(d.total);
    const paid = num(d.amount_paid);
    return {
        ...d,
        items: parseJson<LineItem[]>(d.items, []),
        subtotal: num(d.subtotal),
        vat: num(d.vat),
        vat_rate: num(d.vat_rate),
        total,
        amount_paid: paid,
        balance: Math.max(0, round(total - paid)),
        overdue: isOverdue(d),
        company_name: companyName,
        created_by: undefined,
    };
}

export const PAYBILL = process.env.MPESA_PAYBILL ?? "";
