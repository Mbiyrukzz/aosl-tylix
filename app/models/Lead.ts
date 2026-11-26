import { Model } from "@tylix/orm";

export class Lead extends Model {
    static table = "leads";
    static fillable: string[] = ["name", "email", "phone", "company", "topic", "product", "message", "status"];
}
