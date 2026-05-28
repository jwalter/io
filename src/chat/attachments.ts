import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { PATHS } from "../paths.js";

export interface MessageAttachment {
  name: string;
  mimeType: string;
  size: number;
  content: string;
}

export interface SavedAttachment {
  name: string;
  mimeType: string;
  size: number;
  path: string;
}

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 25 * 1024 * 1024;

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

function isValidBase64(value: string): boolean {
  if (!value || value.length % 4 !== 0) return false;
  return BASE64_RE.test(value);
}

function isMessageAttachment(value: unknown): value is MessageAttachment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<MessageAttachment>;
  return (
    typeof candidate.name === "string" &&
    candidate.name.trim().length > 0 &&
    typeof candidate.mimeType === "string" &&
    candidate.mimeType.trim().length > 0 &&
    typeof candidate.size === "number" &&
    Number.isFinite(candidate.size) &&
    candidate.size >= 0 &&
    typeof candidate.content === "string"
  );
}

export function validateMessageAttachments(
  input: unknown
): { ok: true; attachments: MessageAttachment[] } | { ok: false; error: string } {
  if (input === undefined || input === null) {
    return { ok: true, attachments: [] };
  }
  if (!Array.isArray(input)) {
    return { ok: false, error: "attachments must be an array" };
  }

  let totalSize = 0;
  const attachments: MessageAttachment[] = [];
  for (const raw of input) {
    if (!isMessageAttachment(raw)) {
      return {
        ok: false,
        error: "each attachment must include name, mimeType, size, and content",
      };
    }

    if (raw.size > MAX_ATTACHMENT_BYTES) {
      return { ok: false, error: "each attachment must be 10MB or smaller" };
    }

    if (!isValidBase64(raw.content)) {
      return { ok: false, error: `attachment "${raw.name}" has invalid base64 content` };
    }

    const trimmedName = raw.name.trim();
    const trimmedMimeType = raw.mimeType.trim();
    if (!trimmedName || !trimmedMimeType) {
      return { ok: false, error: "attachment name and mimeType are required" };
    }

    totalSize += raw.size;
    attachments.push({
      name: trimmedName,
      mimeType: trimmedMimeType,
      size: raw.size,
      content: raw.content,
    });
  }

  if (totalSize > MAX_TOTAL_ATTACHMENT_BYTES) {
    return { ok: false, error: "total attachment size must be 25MB or smaller" };
  }

  return { ok: true, attachments };
}

export function toCopilotBlobAttachments(
  attachments: MessageAttachment[]
): Array<{ type: "blob"; data: string; mimeType: string; displayName?: string }> {
  return attachments.map((attachment) => ({
    type: "blob",
    data: attachment.content,
    mimeType: attachment.mimeType,
    displayName: attachment.name,
  }));
}

export function buildAttachmentSummary(attachments: MessageAttachment[]): string {
  if (attachments.length === 0) return "";
  const lines = attachments.map(
    (attachment) =>
      `- ${attachment.name} (${attachment.mimeType}, ${Math.round(attachment.size / 1024)}KB)`
  );
  return `\n\n[Attachments]\n${lines.join("\n")}`;
}

/**
 * Save attachments to disk at ~/.io/attachments/{batchId}/{filename}
 * Returns the saved paths so they can be referenced by the orchestrator and squads.
 */
export function saveAttachmentsToDisk(attachments: MessageAttachment[]): SavedAttachment[] {
  if (attachments.length === 0) return [];

  const batchId = randomUUID();
  const batchDir = join(PATHS.attachments, batchId);
  if (!existsSync(PATHS.attachments)) mkdirSync(PATHS.attachments, { recursive: true });
  mkdirSync(batchDir, { recursive: true });

  return attachments.map((attachment) => {
    const filePath = join(batchDir, attachment.name);
    writeFileSync(filePath, Buffer.from(attachment.content, "base64"));
    return {
      name: attachment.name,
      mimeType: attachment.mimeType,
      size: attachment.size,
      path: filePath,
    };
  });
}

/**
 * Build a summary that includes file paths on disk for tool access.
 */
export function buildAttachmentPathSummary(saved: SavedAttachment[]): string {
  if (saved.length === 0) return "";
  const lines = saved.map(
    (s) => `- ${s.name} (${s.mimeType}, ${Math.round(s.size / 1024)}KB) → ${s.path}`
  );
  return `\n\n[Attached files saved to disk]\n${lines.join("\n")}`;
}
