/** Plain text, never HTML. A locale map must include the definition's defaultLocale. */
export type LocalizedText = string | Readonly<Record<string, string>>;
export type Scalar = string | number | boolean;
export type Condition =
  | { op: "and" | "or"; conditions: readonly Condition[] }
  | { op: "empty" | "notEmpty"; field: string }
  | { op: "eq" | "neq" | "contains"; field: string; value: Scalar }
  | { op: "gt" | "gte" | "lt" | "lte"; field: string; value: number };
export interface Option { id: string; label: LocalizedText }
export interface FieldBase {
  id: string;
  label: LocalizedText;
  description?: LocalizedText;
  visibleWhen?: Condition;
  required?: boolean;
  requiredWhen?: Condition;
}
export type Field = FieldBase & (
  | { type: "text" | "textarea"; minLength?: number; maxLength?: number }
  | { type: "number"; min?: number; max?: number; integer?: boolean }
  | { type: "select"; options: readonly Option[] }
  | { type: "multiselect"; options: readonly Option[]; minItems?: number; maxItems?: number }
  | { type: "date"; min?: string; max?: string }
  | { type: "boolean" }
  | { type: "attachment"; minItems?: number; maxItems?: number; maxBytes?: number; accept?: readonly string[] }
  | { type: "notice" }
);
export interface Group {
  id: string;
  title: LocalizedText;
  description?: LocalizedText;
  fields: readonly Field[];
}
export interface FormDefinition {
  formatVersion: 1;
  id: string;
  revision: string;
  defaultLocale: string;
  title: LocalizedText;
  description?: LocalizedText;
  groups: readonly Group[];
}
export interface AttachmentReference { id: string; name: string; size: number; mime: string }
export type AnswerValue = Scalar | string[] | AttachmentReference[] | null;
export type Answers = Record<string, AnswerValue>;
export interface FieldState { visible: boolean; required: boolean }
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
  field: Extract<Field, { type: "attachment" }>;
  signal: AbortSignal;
  onProgress?: (progress: { loaded: number; total: number }) => void;
}) => Promise<AttachmentReference>;
