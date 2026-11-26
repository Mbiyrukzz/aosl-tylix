import { Mailable } from "@tylix/mail";

// One branded layout for every portal email: ticket replies, quick
// support messages, invoices, project updates and invitations.
export interface NoticeData {
    subject: string;
    heading: string;
    intro: string;
    quote?: string;
    lines?: string[];
    actionUrl?: string;
    actionLabel?: string;
    footnote?: string;
}

export class NoticeMail extends Mailable {
    constructor(private notice: NoticeData) {
        super();
    }

    build() {
        const n = this.notice;
        return {
            subject: n.subject,
            view: "notice",
            data: {
                heading: n.heading,
                intro: n.intro,
                quote: n.quote ?? "",
                lines: (n.lines ?? []).map((line) => ({ line })),
                actionUrl: n.actionUrl ?? "",
                actionLabel: n.actionLabel ?? "Open the portal",
                footnote: n.footnote ?? "You're receiving this because you have an Ashmif Office Solutions account.",
                year: String(new Date().getFullYear()),
            },
        };
    }
}
