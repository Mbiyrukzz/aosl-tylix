import { Model } from "@tylix/orm";

export class Company extends Model {
    static table = "companies";
    static fillable: string[] = ["name", "slug", "tier", "status", "email", "phone", "website", "address", "kra_pin", "industry", "account_manager_id", "notes"];
}
