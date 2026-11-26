/**
 * Document uploads (ticket attachments, CVs). Files arrive as base64 data
 * URLs in JSON, are checked against their real signature (a renamed .exe
 * or HTML file is refused) and saved under public/uploads/files with a
 * random name. SVG and HTML are never accepted: they can carry scripts.
 */
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export const MAX_FILE_BYTES = 3 * 1024 * 1024;

const TYPES: Record<string, { ext: string; sig: (b: Buffer) => boolean }> = {
    "application/pdf": { ext: "pdf", sig: (b) => b.toString("ascii", 0, 5) === "%PDF-" },
    "image/png": { ext: "png", sig: (b) => b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG" },
    "image/jpeg": { ext: "jpg", sig: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
    "image/webp": { ext: "webp", sig: (b) => b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
    "image/gif": { ext: "gif", sig: (b) => b.toString("ascii", 0, 4) === "GIF8" },
    // Office files are zip containers.
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": { ext: "docx", sig: (b) => b[0] === 0x50 && b[1] === 0x4b },
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": { ext: "xlsx", sig: (b) => b[0] === 0x50 && b[1] === 0x4b },
    "application/msword": { ext: "doc", sig: (b) => b[0] === 0xd0 && b[1] === 0xcf },
    "text/plain": { ext: "txt", sig: (b) => !b.subarray(0, 512).includes(0) },
    "text/csv": { ext: "csv", sig: (b) => !b.subarray(0, 512).includes(0) },
};

const DATA_URL_RE = /^data:([a-z0-9.+/-]+);base64,([A-Za-z0-9+/=]+)$/i;
export const FILE_URL_RE = /^\/uploads\/files\/[a-f0-9]{32}\.(pdf|png|jpg|webp|gif|docx|xlsx|doc|txt|csv)$/;

export interface StoredFile {
    url: string;
    name: string;
    size: number;
    type: string;
}

export async function storeDataUrl(dataUrl: unknown, originalName: unknown, allowed?: string[]): Promise<StoredFile | { error: string }> {
    const match = DATA_URL_RE.exec(String(dataUrl ?? ""));
    if (!match) return { error: "That file couldn't be read." };
    const mime = match[1].toLowerCase();
    const type = TYPES[mime];
    if (!type || (allowed && !allowed.includes(mime))) return { error: "That file type isn't supported. Use PDF, Word, Excel, an image or text." };
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > MAX_FILE_BYTES) return { error: "Files must be 3 MB or smaller." };
    if (buffer.length < 4 || !type.sig(buffer)) return { error: "That file doesn't look like what its name says." };

    const file = `${crypto.randomBytes(16).toString("hex")}.${type.ext}`;
    const dir = path.join(process.cwd(), "public", "uploads", "files");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(path.join(dir, file), buffer);

    const name = String(originalName ?? `file.${type.ext}`).replace(/[^\w .()-]/g, "_").slice(0, 120) || `file.${type.ext}`;
    return { url: `/uploads/files/${file}`, name, size: buffer.length, type: mime };
}

// Attachments sent with a ticket or reply: only files this app stored.
export function cleanAttachments(value: unknown): StoredFile[] {
    if (!Array.isArray(value)) return [];
    return value
        .filter((f) => f && FILE_URL_RE.test(String(f.url)))
        .slice(0, 5)
        .map((f) => ({ url: String(f.url), name: String(f.name ?? "file").slice(0, 120), size: Number(f.size) || 0, type: String(f.type ?? "") }));
}
