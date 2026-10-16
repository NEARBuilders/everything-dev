import { globalRegistry } from "zod";
import { commandOptionSchemas } from "../contract";
import type { CommandDescriptor } from "./catalog";

type SchemaLike = {
  def?: {
    type?: string;
    innerType?: SchemaLike;
    shape?: Record<string, SchemaLike>;
    values?: Record<string, string> | string[];
  };
};

/** The flag description is whatever `.describe()` attached along the
 * wrapper chain — check each layer's registry entry. */
export function describeOf(schema: SchemaLike): string | undefined {
  let current = schema;
  while (true) {
    const registered = globalRegistry.get(current as never)?.description;
    if (registered) return registered;
    const inner = current.def?.innerType;
    if (!inner) break;
    current = inner;
  }
  return undefined;
}

function unwrap(schema: SchemaLike): SchemaLike {
  let current = schema;
  while (true) {
    const type = current.def?.type;
    if (type === "default" || type === "optional" || type === "nullable" || type === "nullish") {
      const inner = current.def?.innerType;
      if (!inner) break;
      current = inner;
      continue;
    }
    return current;
  }
  return current;
}

function toFlagName(field: string): string {
  return `--${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

/** Flag help derived from the contract schemas (ticket #426) — the schema is
 * the single flag source; there is no parallel description table. */
export function flagHelpLines(descriptor: CommandDescriptor): string[] {
  const schema = commandOptionSchemas[descriptor.key as keyof typeof commandOptionSchemas];
  const shape = unwrap(schema as never as SchemaLike).def?.shape;
  if (!shape) return [];

  const lines: string[] = [];
  for (const [fieldName, fieldSchema] of Object.entries(shape)) {
    const flag = toFlagName(fieldName);
    const parts: string[] = [flag];
    const description = describeOf(fieldSchema as never);
    if (unwrap(fieldSchema as never as SchemaLike).def?.type === "boolean") {
      parts.push("(boolean)");
    }
    if (description) parts.push(description);
    const def = (fieldSchema as never as { def?: { defaultValue?: unknown } }).def;
    const inner = fieldSchema as never as {
      def?: { innerType?: { def?: { defaultValue?: unknown } } };
    };
    const defaultValue = def?.defaultValue ?? inner.def?.innerType?.def?.defaultValue;
    if (defaultValue !== undefined && typeof defaultValue !== "function") {
      parts.push(`default: ${String(defaultValue)}`);
    }
    lines.push(`    ${parts.join("  ")}`);
  }
  return lines;
}
