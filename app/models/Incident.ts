import { Model } from "@tylix/orm";

export class Incident extends Model {
    static table = "incidents";
    static fillable: string[] = ["product", "title", "body", "impact", "status", "started_at", "resolved_at"];
}
