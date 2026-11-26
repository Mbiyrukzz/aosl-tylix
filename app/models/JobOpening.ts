import { Model } from "@tylix/orm";

export class JobOpening extends Model {
    static table = "job_openings";
    static fillable: string[] = ["title", "department", "location", "employment", "summary", "description", "requirements", "salary", "status"];
}
