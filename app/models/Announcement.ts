import { Model } from "@tylix/orm";

export class Announcement extends Model {
    static table = "announcements";
    static fillable: string[] = ["title", "body", "level", "audience", "published", "expires_at"];
}
