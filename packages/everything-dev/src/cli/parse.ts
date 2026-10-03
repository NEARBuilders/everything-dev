import { commandOptionSchemas } from "../contract";
import type { CommandDescriptor } from "./catalog";

type SchemaLike = {
  def?: {
    type?: string;
    innerType?: SchemaLike;
    shape?: Record<string, SchemaLike>;
    values?: Record<string, string> | string[];
  };
  parse: (value: unknown) => unknown;
};

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

function isBooleanSchema(schema: SchemaLike): boolean {
  return unwrap(schema).def?.type === "boolean";
}

function isArraySchema(schema: SchemaLike): boolean {
  return unwrap(schema).def?.type === "array";
}

function coerceValue(raw: string, schema: SchemaLike): unknown {
  const inner = unwrap(schema);
  switch (inner.def?.type) {
    case "boolean":
      return raw === "true" || raw === "1" || raw === "yes";
    case "number": {
      const value = Number(raw);
      if (Number.isNaN(value)) throw new Error(`Invalid number: ${raw}`);
      return value;
    }
    case "enum":
      return raw;
    default:
      return raw;
  }
}

function toFlagName(field: string): string {
  return `--${field.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()}`;
}

function getShape(schema: SchemaLike): Record<string, SchemaLike> {
  const inner = unwrap(schema);
  const shape = inner.def?.shape;
  if (!shape) return {};
  return shape;
}

export function parseCommandInput(descriptor: CommandDescriptor, argv: string[]): unknown {
  const schema = commandOptionSchemas[descriptor.key as keyof typeof commandOptionSchemas];
  if (!schema) return {};

  const shape = getShape(schema);
  const fields = Object.entries(shape);
  const fieldByFlag = new Map<string, string>();
  const positionalFields: string[] = [];

  for (const [fieldName] of fields) {
    fieldByFlag.set(toFlagName(fieldName), fieldName);
    if (descriptor.meta.fields?.[fieldName]?.positional) {
      positionalFields.push(fieldName);
    }
  }

  const input: Record<string, unknown> = {};
  const positionals: string[] = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token) continue;

    if (token.startsWith("--")) {
      const [flag, inline] = token.split("=", 2);
      const fieldName = fieldByFlag.get(flag);

      if (!fieldName && flag.startsWith("--no-")) {
        const positiveFlagName = `--${flag.slice(5)}`;
        const positiveFieldName = fieldByFlag.get(positiveFlagName);
        if (!positiveFieldName) throw new Error(`Unknown flag: ${token}`);
        input[positiveFieldName] = false;
        continue;
      }

      if (!fieldName) throw new Error(`Unknown flag: ${token}`);

      const fieldSchema = shape[fieldName];
      if (isBooleanSchema(fieldSchema)) {
        input[fieldName] = inline ? coerceValue(inline, fieldSchema) : true;
        continue;
      }

      const next = inline ?? argv[i + 1];

      if (isArraySchema(fieldSchema)) {
        if (next === undefined || next.startsWith("--")) {
          input[fieldName] = [];
          continue;
        }
        input[fieldName] = next
          .split(",")
          .map((s: string) => s.trim())
          .filter(Boolean);
        if (!inline) i += 1;
        continue;
      }

      if (next === undefined || next.startsWith("--")) {
        throw new Error(`Missing value for ${flag}`);
      }
      input[fieldName] = coerceValue(next, fieldSchema);
      if (!inline) i += 1;
      continue;
    }

    positionals.push(token);
  }

  if (positionalFields.length > 0) {
    positionalFields.forEach((fieldName, index) => {
      const raw = positionals[index];
      if (raw !== undefined) {
        input[fieldName] = coerceValue(raw, shape[fieldName]);
      }
    });
  } else if (positionals.length > 0) {
    const candidate = fields.find(([, fieldSchema]) => !isBooleanSchema(fieldSchema));
    if (candidate) {
      const [fieldName, fieldSchema] = candidate;
      input[fieldName] = coerceValue(positionals[0], fieldSchema);
    }
  }

  return schema.parse(input);
}
