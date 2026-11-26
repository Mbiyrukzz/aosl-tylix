import { Model } from "@tylix/orm";

export class Subscription extends Model {
    static table = "subscriptions";
    static fillable: string[] = ["company_id", "product", "name", "kind", "plan", "amount", "currency", "cycle", "starts_on", "renews_on", "status", "auto_renew", "reference", "notes"];
}
