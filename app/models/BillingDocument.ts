import { Model } from "@tylix/orm";

export class BillingDocument extends Model {
    static table = "billing_documents";
    static fillable: string[] = ["kind", "number", "company_id", "subject", "status", "issued_on", "due_on", "currency", "vat_rate", "items", "subtotal", "vat", "total", "amount_paid", "paid_at", "payment_method", "payment_ref", "receipt_number", "source_id", "notes", "created_by"];
}
