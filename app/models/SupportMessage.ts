import { Model } from "@tylix/orm";

export class SupportMessage extends Model {
    static table = "support_messages";
    static fillable: string[] = ["client_id", "company_id", "author_id", "direction", "body", "page_url", "read_at", "ticket_id"];
}
