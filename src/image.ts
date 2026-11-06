import { isField } from "./types.js";
import type { Field } from "./types.js";
export function imageOutput(field: Extract<Field,{type:"image"}>) {
  const o=field.output??{mode:"fixed" as const,width:1600,height:1000};
  const {mode,...options}=o;
  return {...options,quality:o.quality??0.9,minimumQuality:o.minimumQuality??0.82,...(field.maxBytes===undefined?{}:{maxBytes:field.maxBytes}),shrinkToFit:mode==="free"?(o.shrinkToFit??true):false};
}

/** Content references only: no URLs, upload, storage or resource-lifetime policy. */
export function collectDefinitionImages(definition: import("./types.js").AnyFormDefinition): string[] {
  const references = new Set<string>();
  const add = (node: { image?: string }) => { if (node.image) references.add(node.image); };
  add(definition);
  for (const group of definition.groups) {
    add(group);
    for (const field of group.fields) {
      add(field);
      if (isField(field) && (field.type === "select" || field.type === "multiselect"))
        for (const option of field.options) add(option);
    }
  }
  return [...references];
}

/** Rewrite opaque references without introducing a second document or visual model. */
export function mapDefinitionImages<T extends import("./types.js").FormItem = Field>(
  definition: import("./types.js").FormDefinition<T>,
  map: (reference: string) => string,
): import("./types.js").FormDefinition<T> {
  const mapped = <T extends { image?: string }>(node: T): T =>
    node.image === undefined ? { ...node } : { ...node, image: map(node.image) };
  return {
    ...mapped(definition),
    groups: definition.groups.map((group) => ({
      ...mapped(group),
      fields: group.fields.map((field) =>
        isField(field) && (field.type === "select" || field.type === "multiselect")
          ? { ...mapped(field), options: field.options.map(mapped) }
          : mapped(field),
      ),
    })),
  };
}
