import { Model } from "@tylix/orm";

export class Ticket extends Model {
    static table = "tickets";
    static fillable: string[] = ["ref", "company_id", "user_id", "subject", "body", "category", "product", "priority", "status", "source", "assigned_to", "attachments", "sla_due_at", "first_response_at", "resolved_at", "last_activity_at", "rating", "rating_comment"];
}
