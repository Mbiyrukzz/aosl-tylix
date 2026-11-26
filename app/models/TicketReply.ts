import { Model } from "@tylix/orm";

export class TicketReply extends Model {
    static table = "ticket_replies";
    static fillable: string[] = ["ticket_id", "user_id", "body", "internal", "attachments"];
}
