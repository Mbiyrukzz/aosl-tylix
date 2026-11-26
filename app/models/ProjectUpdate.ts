import { Model } from "@tylix/orm";

export class ProjectUpdate extends Model {
    static table = "project_updates";
    static fillable: string[] = ["project_id", "user_id", "body", "progress", "status"];
}
