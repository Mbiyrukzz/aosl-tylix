import { Model } from "@tylix/orm";

export class JobApplication extends Model {
    static table = "job_applications";
    static fillable: string[] = ["opening_id", "name", "email", "phone", "portfolio", "cover_letter", "cv_url", "cv_name", "status"];
}
