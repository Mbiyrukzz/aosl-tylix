import { Model } from "@tylix/orm";

export class Project extends Model {
    static table = "projects";
    static fillable: string[] = ["company_id", "title", "description", "status", "priority", "progress", "starts_on", "due_on", "completed_at", "lead_id", "milestones", "internal_notes"];
}
