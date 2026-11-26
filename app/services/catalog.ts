// The server's copy of the product list (the pages read the richer copy
// in app/capabilities/Catalog.tyx). Keep the slugs in step.
export const PRODUCTS = [
    { slug: "payroflix", name: "Payroflix", url: "https://payroflix.com" },
    { slug: "rekoncile", name: "Rekoncile", url: "https://rekoncile.app" },
    { slug: "medisynq", name: "MediSynq", url: "https://mymedisynq.com" },
    { slug: "sms", name: "Ashmif SMS", url: "https://sms.ashmif.com" },
    { slug: "smartrealtors", name: "SmartRealtors", url: "https://smartrealtors.ashmif.com" },
    { slug: "smartfreight", name: "SmartFreight", url: "https://consolidation.ashmif.com" },
    { slug: "tylix", name: "Tylix", url: "https://tylix.dev" },
    { slug: "flux", name: "Tylix Flux", url: "https://flux.tylix.dev" },
] as const;

export const PRODUCT_SLUGS = PRODUCTS.map((p) => p.slug) as string[];

// Things that aren't products but clients still raise tickets about.
export const OTHER_AREAS = ["website", "hosting", "custom", "other"];

export function productName(slug: unknown): string {
    const p = PRODUCTS.find((x) => x.slug === slug);
    if (p) return p.name;
    const names: Record<string, string> = { website: "Website", hosting: "Hosting & email", custom: "Custom software", other: "General" };
    return names[String(slug)] ?? "General";
}

export const TICKET_CATEGORIES = ["technical", "billing", "account", "feature", "request", "other"] as const;
export const TICKET_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export const TICKET_STATUSES = ["open", "in_progress", "awaiting_client", "resolved", "closed"] as const;
