/**
 * Checks tool call arguments against the input schema that the agent was
 * shown, before the tool gateway asks a human to approve the call.
 *
 * The check only validates. It never fills defaults, renames properties or
 * converts types, so the arguments a human reviews are the arguments the agent
 * sent.
 *
 * Rules:
 * - No schema, an empty schema, or an object schema without `properties`:
 *   the call passes through unchanged. The gateway cannot tell a mistake from
 *   a valid call without a declared shape.
 * - A schema that does not compile: the call passes through. A provider schema
 *   that this validator cannot read must not block every call to the tool.
 * - Otherwise the arguments must satisfy the schema (required properties,
 *   types, enums). A top-level property that is not in `properties` is an
 *   error unless the schema allows extra properties (`additionalProperties`
 *   other than `false`, `patternProperties`, or a composed schema).
 */
import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

export type ToolArgumentSchemaCheck =
  | { ok: true }
  | {
      ok: false;
      missingProperties: string[];
      unknownProperties: string[];
      invalidValues: string[];
      expectedProperties: string[];
      message: string;
    };

const AjvCtor = (Ajv as any).default ?? Ajv;
const ajv = new AjvCtor({
  strict: false,
  allErrors: true,
  validateFormats: false,
  useDefaults: false,
  coerceTypes: false,
  removeAdditional: false,
});

const MAX_CACHED_VALIDATORS = 256;
const validators = new Map<string, ValidateFunction | null>();

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function compiledValidator(schema: Record<string, unknown>): ValidateFunction | null {
  const key = JSON.stringify(schema);
  if (validators.has(key)) return validators.get(key) ?? null;
  // The default Ajv build reads draft-07 keywords. Drop the dialect marker so
  // a draft 2020-12 schema with the common keywords still compiles.
  const { $schema: _dialect, ...withoutDialect } = schema;
  let validate: ValidateFunction | null;
  try {
    validate = ajv.compile(withoutDialect) as ValidateFunction;
  } catch {
    validate = null;
  }
  if (validators.size >= MAX_CACHED_VALIDATORS) validators.clear();
  validators.set(key, validate);
  return validate;
}

function allowsUndeclaredProperties(schema: Record<string, unknown>) {
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) return true;
  if (asRecord(schema.patternProperties)) return true;
  return ["allOf", "anyOf", "oneOf", "$ref", "if", "dependentSchemas", "unevaluatedProperties"]
    .some((keyword) => schema[keyword] !== undefined);
}

function describeAjvError(error: ErrorObject): string | null {
  if (error.keyword === "required" || error.keyword === "additionalProperties") return null;
  const path = error.instancePath.replace(/^\//, "").replace(/\//g, ".");
  return `${path || "arguments"} ${error.message ?? "is invalid"}`;
}

export function checkToolArgumentsAgainstSchema(
  toolName: string,
  schema: unknown,
  parameters: unknown,
): ToolArgumentSchemaCheck {
  const schemaRecord = asRecord(schema);
  const properties = asRecord(schemaRecord?.properties);
  if (!schemaRecord || !properties) return { ok: true };
  const validate = compiledValidator(schemaRecord);
  if (!validate) return { ok: true };

  const required = Array.isArray(schemaRecord.required)
    ? schemaRecord.required.filter((name): name is string => typeof name === "string")
    : [];
  // Required names first, in schema order, then the optional names sorted.
  // Stored schemas (jsonb) do not keep the provider's property order.
  const expectedProperties = [
    ...required.filter((name) => Object.prototype.hasOwnProperty.call(properties, name)),
    ...Object.keys(properties).filter((name) => !required.includes(name)).sort(),
  ];
  const args = asRecord(parameters);

  const missingProperties = new Set<string>();
  const unknownProperties = new Set<string>();
  const invalidValues: string[] = [];

  if (!args) {
    invalidValues.push("arguments must be an object");
  } else {
    validate(args);
    for (const error of validate.errors ?? []) {
      const atRoot = error.instancePath === "";
      if (error.keyword === "required" && atRoot) {
        missingProperties.add(String((error.params as { missingProperty?: unknown }).missingProperty));
        continue;
      }
      if (error.keyword === "additionalProperties" && atRoot) {
        unknownProperties.add(String((error.params as { additionalProperty?: unknown }).additionalProperty));
        continue;
      }
      const described = describeAjvError(error);
      if (described) invalidValues.push(described);
    }
    if (!allowsUndeclaredProperties(schemaRecord)) {
      for (const name of Object.keys(args)) {
        if (!Object.prototype.hasOwnProperty.call(properties, name)) unknownProperties.add(name);
      }
    }
  }

  if (missingProperties.size === 0 && unknownProperties.size === 0 && invalidValues.length === 0)
    return { ok: true };

  const missing = required.filter((name) => missingProperties.has(name))
    .concat([...missingProperties].filter((name) => !required.includes(name)));
  const unknown = [...unknownProperties];
  const requiredSet = new Set(required);
  const lines = [`The arguments for ${toolName} do not match its input schema.`];
  if (missing.length > 0) lines.push(`Missing required properties: ${missing.join(", ")}.`);
  if (unknown.length > 0) lines.push(`Unknown properties: ${unknown.join(", ")}.`);
  if (invalidValues.length > 0) lines.push(`Invalid values: ${invalidValues.join("; ")}.`);
  lines.push(
    `Expected properties: ${expectedProperties
      .map((name) => (requiredSet.has(name) ? `${name} (required)` : name))
      .join(", ")}.`,
  );
  lines.push("No approval was requested. Correct the arguments and call the tool again.");
  return {
    ok: false,
    missingProperties: missing,
    unknownProperties: unknown,
    invalidValues,
    expectedProperties,
    message: lines.join(" "),
  };
}
