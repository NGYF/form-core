import { normalizeAnswers } from "./answers.js";
import { internal, resolveText, type CompiledForm } from "./definition.js";
import type { FormDefinition, Submission } from "./types.js";

export interface ExportRecord { form: CompiledForm; submission: Submission }
function stableJSON(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJSON).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => `${JSON.stringify(key)}:${stableJSON(child)}`).join(",")}}`;
  return JSON.stringify(value);
}
function canonical({ form, submission }: ExportRecord): Submission {
  internal(form);
  if (submission.formId !== form.definition.id || submission.revision !== form.definition.revision) throw new TypeError("Submission must match its immutable definition version");
  if (typeof submission.id !== "string" || !submission.id.trim()) throw new TypeError("Submission ID is required");
  if (submission.submittedAt !== undefined && (typeof submission.submittedAt !== "string" || !/^\d{4}-\d{2}-\d{2}T/.test(submission.submittedAt) || !Number.isFinite(Date.parse(submission.submittedAt)))) throw new TypeError("submittedAt must be an ISO timestamp");
  return { id: submission.id, formId: submission.formId, revision: submission.revision, ...(submission.submittedAt !== undefined ? { submittedAt: submission.submittedAt } : {}), answers: normalizeAnswers(form, submission.answers) };
}
function prepare(records: readonly ExportRecord[]) {
  const definitions = new Map<string, FormDefinition>();
  const fingerprints = new Map<string, string>();
  const objects = new WeakMap<FormDefinition, string>();
  const submissions = records.map((record) => {
    const submission = canonical(record), definition = record.form.definition;
    const key = JSON.stringify([definition.id, definition.revision]);
    let fingerprint = objects.get(definition);
    if (fingerprint === undefined) { fingerprint = stableJSON(definition); objects.set(definition, fingerprint); }
    const previous = fingerprints.get(key);
    if (previous !== undefined && previous !== fingerprint) throw new TypeError("Conflicting definitions for the same revision");
    fingerprints.set(key, fingerprint);
    definitions.set(key, definition); return submission;
  });
  return { formatVersion: 1, definitions: [...definitions.values()], submissions };
}
export function exportJSON(records: readonly ExportRecord[]): string {
  return JSON.stringify(prepare(records), null, 2);
}
export interface CSVColumn {
  key: string;
  formId: string;
  revision: string;
  fieldId: string;
  group: string;
  label: string;
  type: string;
  options?: { id: string; label: string }[];
}
// Quoting alone does not neutralize spreadsheet formulas. Prefix unsafe cells.
function cell(value: string): string {
  // eslint-disable-next-line no-control-regex -- Spreadsheet formula prefixes can follow control characters.
  const safe = /^[\s\u0000-\u001f]*[=+@-]/u.test(value) || /^[\t\r\n]/u.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
/** Stable IDs in headers; localized human-readable column descriptions alongside CSV. */
export function exportCSV(records: readonly ExportRecord[], locale?: string): { csv: string; columns: CSVColumn[] } {
  // Also detects conflicting snapshots before combining revisions.
  const { submissions } = prepare(records);
  const columns = new Map<string, CSVColumn>();
  for (const { form } of records) {
    const definition = form.definition, lang = locale ?? definition.defaultLocale;
    for (const group of definition.groups) for (const field of group.fields) {
      if (field.type === "notice") continue;
      const key = `answer:${JSON.stringify([definition.id, definition.revision, field.id])}`;
      if (!columns.has(key)) columns.set(key, {
        key, formId: definition.id, revision: definition.revision, fieldId: field.id,
        group: resolveText(group.title, lang, definition.defaultLocale), label: resolveText(field.label, lang, definition.defaultLocale), type: field.type,
        ...("options" in field ? { options: field.options.map((option) => ({ id: option.id, label: resolveText(option.label, lang, definition.defaultLocale) })) } : {}),
      });
    }
  }
  const description = [...columns.values()];
  const rows = [["id", "formId", "revision", "submittedAt", ...description.map((column) => column.key)]];
  for (const submission of submissions) {
    rows.push([submission.id, submission.formId, submission.revision, submission.submittedAt ?? "", ...description.map((column) => {
      if (column.formId !== submission.formId || column.revision !== submission.revision) return "";
      const value = submission.answers[column.fieldId];
      return value === undefined || value === null ? "" : Array.isArray(value) ? JSON.stringify(value) : String(value);
    })]);
  }
  return { csv: rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n", columns: description };
}
