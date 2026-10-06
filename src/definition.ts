import type { Condition, Field, FormDefinition, LocalizedText } from "./types.js";

export interface DefinitionIssue { path: string; code: string }
export class DefinitionError extends Error {
  constructor(public readonly issues: readonly DefinitionIssue[]) {
    super("Invalid form definition");
    this.name = "DefinitionError";
  }
}
export interface CompiledForm { readonly definition: FormDefinition }
interface InternalForm { fields: readonly Field[]; order: readonly Field[] }
const compiled = new WeakMap<CompiledForm, InternalForm>();
const identifier = /^[A-Za-z][A-Za-z0-9_-]{0,127}$/;
export function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === "string" && value.trim() === "") || (Array.isArray(value) && value.length === 0);
}
export function isDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function resolveText(text: LocalizedText, locale: string, defaultLocale: string): string {
  return typeof text === "string" ? text : (Object.hasOwn(text, locale) ? text[locale]! : Object.hasOwn(text, defaultLocale) ? text[defaultLocale]! : "");
}

/** Validate untrusted JSON before compiling. Limits bound both client and server work. */
export function validateDefinition(input: unknown): { valid: boolean; issues: DefinitionIssue[] } {
  const issues: DefinitionIssue[] = [];
  const fail = (path: string, code = "type") => { issues.push({ path, code }); };
  if (!isRecord(input)) return { valid: false, issues: [{ path: "", code: "type" }] };
  const locale = input.defaultLocale;
  const text = (value: unknown, path: string) => {
    if (typeof value === "string") { if (!value.trim() || value.length > 20000) fail(path, "text"); return; }
    if (!isRecord(value) || typeof locale !== "string" || !Object.hasOwn(value, locale) || Object.keys(value).length > 100) { fail(path, "text"); return; }
    for (const [key, label] of Object.entries(value)) {
      if (!key || typeof label !== "string" || !label.trim() || label.length > 20000) fail(path, "text");
    }
  };
  const id = (value: unknown, path: string) => {
    if (typeof value !== "string" || !identifier.test(value) || ["__proto__", "constructor", "prototype"].includes(value)) fail(path, "id");
  };
  const optionalText = (object: Record<string, unknown>, path: string) => {
    if (object.description !== undefined) text(object.description, `${path}.description`);
  };
  const keys = (object: Record<string, unknown>, allowed: readonly string[], path: string) => {
    for (const key of Object.keys(object)) if (!allowed.includes(key)) fail(`${path}.${key}`, "unknownProperty");
  };
  keys(input, ["formatVersion", "id", "revision", "defaultLocale", "title", "description", "groups"], "");
  if (input.formatVersion !== 1) fail("formatVersion", "version");
  id(input.id, "id");
  if (typeof input.revision !== "string" || !input.revision.trim() || input.revision.length > 128) fail("revision");
  if (typeof locale !== "string" || !locale.trim() || locale.length > 64) fail("defaultLocale");
  text(input.title, "title"); optionalText(input, "");
  if (!Array.isArray(input.groups) || input.groups.length > 100) {
    fail("groups", "limit"); return { valid: false, issues };
  }
  const fields = new Map<string, { field: Record<string, unknown>; path: string }>();
  const groups = new Set<string>();
  const pending: { value: unknown; path: string; owner: string }[] = [];
  const common = ["id", "type", "label", "description", "visibleWhen", "required", "requiredWhen"];
  const extras: Record<string, string[]> = {
    text: ["minLength", "maxLength"], textarea: ["minLength", "maxLength"], number: ["min", "max", "integer"],
    select: ["options"], multiselect: ["options", "minItems", "maxItems"], date: ["min", "max"],
    boolean: [], attachment: ["minItems", "maxItems", "maxBytes", "accept"], notice: [],
  };
  let total = 0;
  for (const [gi, group] of input.groups.entries()) {
    const path = `groups.${gi}`;
    if (!isRecord(group)) { fail(path); continue; }
    keys(group, ["id", "title", "description", "fields"], path);
    id(group.id, `${path}.id`); text(group.title, `${path}.title`); optionalText(group, path);
    if (typeof group.id === "string") { if (groups.has(group.id)) fail(`${path}.id`, "duplicate"); groups.add(group.id); }
    if (!Array.isArray(group.fields) || (total += group.fields.length) > 500) { fail(`${path}.fields`, "limit"); continue; }
    for (const [fi, field] of group.fields.entries()) {
      const fp = `${path}.fields.${fi}`;
      if (!isRecord(field)) { fail(fp); continue; }
      id(field.id, `${fp}.id`); text(field.label, `${fp}.label`); optionalText(field, fp);
      if (typeof field.type !== "string" || !Object.hasOwn(extras, field.type)) { fail(`${fp}.type`); continue; }
      keys(field, [...common, ...extras[field.type]!], fp);
      if (typeof field.id === "string") {
        if (fields.has(field.id)) fail(`${fp}.id`, "duplicate");
        fields.set(field.id, { field, path: fp });
      }
      for (const name of ["required", "integer"]) if (field[name] !== undefined && typeof field[name] !== "boolean") fail(`${fp}.${name}`);
      if (field.type === "notice" && (field.required !== undefined || field.requiredWhen !== undefined)) fail(fp, "noticeRequired");
      for (const name of ["visibleWhen", "requiredWhen"]) if (field[name] !== undefined) pending.push({ value: field[name], path: `${fp}.${name}`, owner: String(field.id) });
      for (const name of ["minLength", "maxLength", "minItems", "maxItems", "maxBytes"]) {
        if (field[name] !== undefined && (typeof field[name] !== "number" || !Number.isSafeInteger(field[name]) || field[name] < 0)) fail(`${fp}.${name}`, "range");
      }
      for (const [minimum, maximum] of [["minLength", "maxLength"], ["minItems", "maxItems"], ["min", "max"]]) {
        const lower = field[minimum!], upper = field[maximum!];
        if ((typeof lower === "number" && typeof upper === "number" && lower > upper) || (typeof lower === "string" && typeof upper === "string" && lower > upper)) fail(fp, "range");
      }
      if (field.type === "number") for (const name of ["min", "max"]) {
        if (field[name] !== undefined && (typeof field[name] !== "number" || !Number.isFinite(field[name]))) fail(`${fp}.${name}`, "range");
      }
      if (field.type === "date") for (const name of ["min", "max"]) if (field[name] !== undefined && !isDate(field[name])) fail(`${fp}.${name}`, "date");
      if (field.type === "select" || field.type === "multiselect") {
        if (!Array.isArray(field.options) || !field.options.length || field.options.length > 500) { fail(`${fp}.options`, "limit"); continue; }
        const options = new Set<string>();
        for (const [oi, option] of field.options.entries()) {
          const op = `${fp}.options.${oi}`;
          if (!isRecord(option)) { fail(op); continue; }
          keys(option, ["id", "label"], op); id(option.id, `${op}.id`); text(option.label, `${op}.label`);
          if (typeof option.id === "string") { if (options.has(option.id)) fail(`${op}.id`, "duplicate"); options.add(option.id); }
        }
        if (typeof field.minItems === "number" && field.minItems > field.options.length) fail(fp, "range");
      }
      if (field.type === "attachment" && field.accept !== undefined && (!Array.isArray(field.accept) || field.accept.length > 100 || field.accept.some((mime) => typeof mime !== "string" || !/^[a-z0-9!#$&^_.+-]+\/(?:[a-z0-9!#$&^_.+-]+|\*)$/i.test(mime)))) fail(`${fp}.accept`, "mime");
    }
  }
  const dependencies = new Map<string, Set<string>>();
  let nodes = 0;
  const condition = (value: unknown, path: string, owner: string, depth: number): void => {
    if (++nodes > 5000 || depth > 16) { fail(path, "limit"); return; }
    if (!isRecord(value)) { fail(path); return; }
    if (value.op === "and" || value.op === "or") {
      keys(value, ["op", "conditions"], path);
      if (!Array.isArray(value.conditions) || !value.conditions.length || value.conditions.length > 100) { fail(path, "condition"); return; }
      value.conditions.forEach((child, index) => condition(child, `${path}.conditions.${index}`, owner, depth + 1)); return;
    }
    if (!["empty", "notEmpty", "eq", "neq", "contains", "gt", "gte", "lt", "lte"].includes(String(value.op))) { fail(path, "condition"); return; }
    keys(value, value.op === "empty" || value.op === "notEmpty" ? ["op", "field"] : ["op", "field", "value"], path);
    const target = typeof value.field === "string" ? fields.get(value.field)?.field : undefined;
    if (!target || target.type === "notice") { fail(`${path}.field`, "reference"); return; }
    const deps = dependencies.get(owner) ?? new Set<string>(); deps.add(String(value.field)); dependencies.set(owner, deps);
    if (value.op === "empty" || value.op === "notEmpty") return;
    if (["gt", "gte", "lt", "lte"].includes(String(value.op))) {
      if (target.type !== "number" || typeof value.value !== "number" || !Number.isFinite(value.value)) fail(path, "conditionType");
    } else if (value.op === "contains") {
      if (target.type !== "multiselect" || typeof value.value !== "string" || !Array.isArray(target.options) || !target.options.some((option) => isRecord(option) && option.id === value.value)) fail(path, "conditionType");
    } else {
      const type = target.type === "number" ? "number" : target.type === "boolean" ? "boolean" : "string";
      if (["attachment", "multiselect"].includes(String(target.type)) || typeof value.value !== type || (type === "number" && !Number.isFinite(value.value))) fail(path, "conditionType");
      if (target.type === "date" && !isDate(value.value)) fail(path, "date");
      if (target.type === "select" && Array.isArray(target.options) && !target.options.some((option) => isRecord(option) && option.id === value.value)) fail(path, "option");
    }
  };
  pending.forEach(({ value, path, owner }) => condition(value, path, owner, 0));
  const visiting = new Set<string>(), visited = new Set<string>();
  const visit = (field: string): void => {
    if (visiting.has(field)) { fail(fields.get(field)?.path ?? field, "cycle"); return; }
    if (visited.has(field)) return;
    visiting.add(field); dependencies.get(field)?.forEach(visit); visiting.delete(field); visited.add(field);
  };
  fields.forEach((_, field) => visit(field));
  return { valid: issues.length === 0, issues };
}
function references(condition: Condition | undefined): string[] {
  if (!condition) return [];
  return "conditions" in condition ? condition.conditions.flatMap(references) : [condition.field];
}
function freeze<T>(value: T): T {
  if (value !== null && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
export function compileDefinition(input: unknown): CompiledForm {
  const result = validateDefinition(input);
  if (!result.valid) throw new DefinitionError(result.issues);
  const definition = freeze(JSON.parse(JSON.stringify(input)) as FormDefinition);
  const fields = definition.groups.flatMap((group) => group.fields);
  const byId = new Map(fields.map((field) => [field.id, field]));
  const order: Field[] = [], visited = new Set<string>();
  const visit = (field: Field): void => {
    if (visited.has(field.id)) return;
    visited.add(field.id);
    [...references(field.visibleWhen), ...references(field.requiredWhen)].forEach((id) => visit(byId.get(id)!));
    order.push(field);
  };
  fields.forEach(visit);
  const form = Object.freeze({ definition }); compiled.set(form, { fields, order }); return form;
}
export function internal(form: CompiledForm): InternalForm {
  const value = compiled.get(form);
  if (!value) throw new TypeError("Use compileDefinition to create a compiled form");
  return value;
}
