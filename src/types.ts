/** Plain text, never HTML. A locale map must include the definition's defaultLocale. */
export type LocalizedText = string | Readonly<Record<string, string>>;
export type Scalar = string | number | boolean;
export type Condition =
  | { op: "and" | "or"; conditions: readonly Condition[] }
  | { op: "empty" | "notEmpty"; field: string }
  | { op: "eq" | "neq" | "contains"; field: string; value: Scalar }
  | { op: "gt" | "gte" | "lt" | "lte"; field: string; value: number };
/** Opaque content-image references are resolved and persisted by the host. */
export interface Option { image?: string; id: string; label: LocalizedText; description?: LocalizedText; enableWhen?: Condition }
export interface FieldBase {
  image?: string;
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  visibleWhen?: Condition;
  required?: boolean;
  requiredWhen?: Condition;
}
export interface ImageOptions {
  mode: "fixed" | "free";
  width?: number; height?: number; maxWidth?: number; maxHeight?: number;
  maxEdge?: number; maxShortEdge?: number; quality?: number; minimumQuality?: number; shrinkToFit?: boolean;
}
export type Field = FieldBase & (
  | { type: "text" | "textarea"; minLength?: number; maxLength?: number }
  | { type: "number"; min?: number; max?: number; integer?: boolean }
  | { type: "select"; options: readonly Option[] }
  | { type: "multiselect"; options: readonly Option[]; minItems?: number; maxItems?: number }
  | { type: "date"; min?: string; max?: string }
  | { type: "boolean" }
  | { type: "image"; minItems?: number; maxItems?: number; maxBytes?: number; output?: ImageOptions }
  | { type: "attachment"; minItems?: number; maxItems?: number; maxBytes?: number; accept?: readonly string[] }
  | { type: "notice" }
);
export interface Group<T extends FormItem = Field> {
  image?: string;
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  fields: readonly T[];
}
export interface FormDefinition<T extends FormItem = Field> {
  image?: string;
  formatVersion: 1;
  id: string;
  revision: string;
  defaultLocale: string;
  title: LocalizedText;
  description?: LocalizedText;
  groups: readonly Group<T>[];
}
export interface AttachmentReference { id: string; name: string; size: number; mime: string }
export type AnswerValue = Scalar | string[] | AttachmentReference[] | null;
export type Answers = Record<string, AnswerValue>;
export interface FieldState { visible: boolean; required: boolean; enabledOptions?: Record<string, boolean> }
export type ErrorCode = "required" | "type" | "min" | "max" | "minLength" | "maxLength" | "integer" | "option" | "duplicate" | "date" | "minItems" | "maxItems" | "maxBytes" | "mime";
export interface AnswerIssue { code: ErrorCode; params?: Record<string, string | number> }
export interface ValidationResult {
  valid: boolean;
  answers: Answers;
  errors: Record<string, AnswerIssue[]>;
  states: Record<string, FieldState>;
}
export interface Submission {
  id: string;
  formId: string;
  revision: string;
  answers: Answers;
  submittedAt?: string;
}
/** Sites implement authorization, transport, persistence and cleanup. */
export type UploadAdapter = (file: File, context: {
  field: Extract<Field, { type: "attachment" | "image" }>;
  signal: AbortSignal;
  onProgress?: (progress: { loaded: number; total: number }) => void;
}) => Promise<AttachmentReference>;

/** Open data: unknown item types are preserved as display-only items. */
export interface CustomItem extends FieldBase { type: string; config?: unknown }
export type FormItem = Field | CustomItem;
const builtinTypes = new Set(["text","textarea","number","select","multiselect","date","boolean","image","attachment","notice"]);
export function isField(item: FormItem): item is Field { return builtinTypes.has(item.type); }
export function isFieldType<T extends Field["type"]>(item: FormItem, ...types: readonly T[]): item is Field & {type:T} { return isField(item) && (types as readonly string[]).includes(item.type); }

/** Opt in to custom display items without changing builtin field narrowing. */
export type AnyFormDefinition = FormDefinition<FormItem>;
