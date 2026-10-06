import { internal, isDate, isEmpty, isRecord, resolveText, type CompiledForm } from "./definition.js";
import type { AnswerIssue, Answers, AnswerValue, AttachmentReference, Condition, Field, FieldState, ValidationResult } from "./types.js";

function matches(condition: Condition, answers: Readonly<Record<string, unknown>>): boolean {
  if ("conditions" in condition) return condition.op === "and" ? condition.conditions.every((child) => matches(child, answers)) : condition.conditions.some((child) => matches(child, answers));
  const value = Object.hasOwn(answers, condition.field) ? answers[condition.field] : undefined;
  if (condition.op === "empty") return isEmpty(value);
  if (condition.op === "notEmpty") return !isEmpty(value);
  // Missing/hidden answers cannot satisfy a comparison, including neq.
  if (isEmpty(value)) return false;
  switch (condition.op) {
    case "eq": return value === condition.value;
    case "neq": return value !== condition.value;
    case "contains": return Array.isArray(value) && value.includes(condition.value);
    case "gt": return typeof value === "number" && value > condition.value;
    case "gte": return typeof value === "number" && value >= condition.value;
    case "lt": return typeof value === "number" && value < condition.value;
    case "lte": return typeof value === "number" && value <= condition.value;
  }
}
/** Calculates in dependency order; values from hidden fields never affect other fields. */
export function evaluateFields(form: CompiledForm, input: Readonly<Record<string, unknown>>): Record<string, FieldState> {
  if (!isRecord(input)) throw new TypeError("Answers must be an object");
  const effective: Record<string, unknown> = Object.create(null);
  const states: Record<string, FieldState> = Object.create(null);
  for (const field of internal(form).order) {
    const visible = !field.visibleWhen || matches(field.visibleWhen, effective);
    const required = visible && field.type !== "notice" && (field.required === true || (field.requiredWhen !== undefined && matches(field.requiredWhen, effective)));
    states[field.id] = { visible, required };
    if (visible && field.type !== "notice" && Object.hasOwn(input, field.id)) effective[field.id] = input[field.id];
  }
  return states;
}
export function isAttachmentReference(value: unknown): value is AttachmentReference {
  return isRecord(value) && typeof value.id === "string" && !!value.id.trim() && value.id.length <= 2048 &&
    typeof value.name === "string" && !!value.name.trim() && value.name.length <= 2048 &&
    typeof value.size === "number" && Number.isSafeInteger(value.size) && value.size >= 0 &&
    typeof value.mime === "string" && /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(value.mime);
}
function check(field: Field, value: unknown): AnswerIssue[] {
  const errors: AnswerIssue[] = [];
  const error = (code: AnswerIssue["code"], params?: AnswerIssue["params"]) => { errors.push(params ? { code, params } : { code }); };
  switch (field.type) {
    case "text": case "textarea":
      if (typeof value !== "string") { error("type"); break; }
      if (field.minLength !== undefined && value.length < field.minLength) error("minLength", { limit: field.minLength });
      if (field.maxLength !== undefined && value.length > field.maxLength) error("maxLength", { limit: field.maxLength });
      break;
    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) { error("type"); break; }
      if (field.integer && !Number.isSafeInteger(value)) error("integer");
      if (field.min !== undefined && value < field.min) error("min", { limit: field.min });
      if (field.max !== undefined && value > field.max) error("max", { limit: field.max });
      break;
    case "boolean": if (typeof value !== "boolean") error("type"); break;
    case "date":
      if (!isDate(value)) { error("date"); break; }
      if (field.min !== undefined && value < field.min) error("min", { limit: field.min });
      if (field.max !== undefined && value > field.max) error("max", { limit: field.max });
      break;
    case "select":
      if (typeof value !== "string") error("type");
      else if (!field.options.some((option) => option.id === value)) error("option");
      break;
    case "multiselect":
      if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) { error("type"); break; }
      if (new Set(value).size !== value.length) error("duplicate");
      if (value.some((item) => !field.options.some((option) => option.id === item))) error("option");
      if (field.minItems !== undefined && value.length < field.minItems) error("minItems", { limit: field.minItems });
      if (field.maxItems !== undefined && value.length > field.maxItems) error("maxItems", { limit: field.maxItems });
      break;
    case "attachment":
      if (!Array.isArray(value) || !value.every(isAttachmentReference)) { error("type"); break; }
      if (new Set(value.map((item) => item.id)).size !== value.length) error("duplicate");
      if (field.minItems !== undefined && value.length < field.minItems) error("minItems", { limit: field.minItems });
      if (field.maxItems !== undefined && value.length > field.maxItems) error("maxItems", { limit: field.maxItems });
      for (const item of value) {
        if (field.maxBytes !== undefined && item.size > field.maxBytes) error("maxBytes", { limit: field.maxBytes, attachment: item.id });
        if (field.accept?.length && !field.accept.some((mime) => mime.toLowerCase() === item.mime.toLowerCase() || (mime.endsWith("/*") && item.mime.toLowerCase().startsWith(mime.slice(0, -1).toLowerCase())))) error("mime", { attachment: item.id });
      }
      break;
    case "notice": break;
  }
  return errors;
}
/** No string-to-number coercion. null/blank/[] are absent; false and zero are answers. */
export function validateAnswers(form: CompiledForm, input: Readonly<Record<string, unknown>>): ValidationResult {
  const states = evaluateFields(form, input);
  const answers: Answers = Object.create(null), errors: Record<string, AnswerIssue[]> = Object.create(null);
  for (const field of internal(form).fields) {
    if (field.type === "notice" || !states[field.id]!.visible) continue;
    const value = Object.hasOwn(input, field.id) ? input[field.id] : undefined;
    if (isEmpty(value)) {
      // An empty container of the wrong type must not bypass validation.
      const wrongEmptyType = value !== undefined && value !== null && ((Array.isArray(value) && !["attachment", "multiselect"].includes(field.type)) || (typeof value === "string" && !["text", "textarea", "date", "select"].includes(field.type)));
      if (wrongEmptyType) errors[field.id] = [{ code: "type" }];
      else if (states[field.id]!.required) errors[field.id] = [{ code: "required" }];
      continue;
    }
    const issues = check(field, value);
    if (issues.length) { errors[field.id] = issues; continue; }
    if (field.type === "attachment") answers[field.id] = (value as AttachmentReference[]).map(({ id, name, size, mime }) => ({ id, name, size, mime }));
    else answers[field.id] = Array.isArray(value) ? [...value] as string[] : value as AnswerValue;
  }
  return { valid: Object.keys(errors).length === 0, answers, errors, states };
}
export class AnswerValidationError extends Error {
  constructor(public readonly result: ValidationResult) { super("Invalid form answers"); this.name = "AnswerValidationError"; }
}
/** Canonical, serializable answers. Throws rather than silently exporting invalid data. */
export function normalizeAnswers(form: CompiledForm, input: Readonly<Record<string, unknown>>): Answers {
  const result = validateAnswers(form, input);
  if (!result.valid) throw new AnswerValidationError(result);
  return result.answers;
}
export interface OrganizedField { id: string; type: Field["type"]; label: string; description?: string; value: AnswerValue | undefined; displayValue: string }
export interface OrganizedGroup { id: string; title: string; description?: string; fields: OrganizedField[] }
export function organizeAnswers(form: CompiledForm, input: Readonly<Record<string, unknown>>, locale = form.definition.defaultLocale): OrganizedGroup[] {
  const result = validateAnswers(form, input);
  if (!result.valid) throw new AnswerValidationError(result);
  const { answers, states } = result;
  const text = (value: Parameters<typeof resolveText>[0]) => resolveText(value, locale, form.definition.defaultLocale);
  return form.definition.groups.map((group) => ({
    id: group.id, title: text(group.title), ...(group.description !== undefined ? { description: text(group.description) } : {}),
    fields: group.fields.filter((field) => states[field.id]!.visible).map((field) => {
      const value = answers[field.id];
      let displayValue = value === undefined || value === null ? "" : String(value);
      if (field.type === "select") displayValue = field.options.filter((option) => option.id === value).map((option) => text(option.label)).join(", ");
      if (field.type === "multiselect") displayValue = field.options.filter((option) => (value as string[] | undefined)?.includes(option.id)).map((option) => text(option.label)).join(", ");
      if (field.type === "attachment") displayValue = ((value ?? []) as AttachmentReference[]).map((item) => item.name).join(", ");
      return { id: field.id, type: field.type, label: text(field.label), ...(field.description !== undefined ? { description: text(field.description) } : {}), value, displayValue };
    }),
  }));
}
