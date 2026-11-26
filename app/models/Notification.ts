import { Model } from "@tylix/orm";

export class Notification extends Model {
    static table = "notifications";
    static fillable: string[] = ["user_id", "kind", "title", "body", "url", "read_at"];
}
