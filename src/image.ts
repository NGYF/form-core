import type { Field } from "./types.js";
export function imageOutput(field: Extract<Field,{type:"image"}>) {
  const o=field.output??{mode:"fixed" as const,width:1600,height:1000};
  const {mode,...options}=o;
  return {...options,quality:o.quality??0.9,minimumQuality:o.minimumQuality??0.82,...(field.maxBytes===undefined?{}:{maxBytes:field.maxBytes}),shrinkToFit:mode==="free"?(o.shrinkToFit??true):false};
}
