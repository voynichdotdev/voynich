// The OpenAPI 3.1 document, generated from the contract's zod schemas so it can't drift from what
// the server validates. Pure: the project's build writes it to openapi.json and the API serves it.

import { z } from 'zod'
import { PositiveU64, U64, U64_MAX } from './primitives.js'

export type Operation = {
  method: 'get' | 'post' | 'put' | 'patch' | 'delete'
  /** OpenAPI path template, e.g. /v1/coins/{mint} */
  path: string
  operationId: string
  summary: string
  description?: string
  /** names of entries in `schemas` */
  response: string
  request?: string
  query?: z.ZodObject
  /** path parameter name → schema name; unnamed parameters are plain strings */
  params?: Record<string, string>
  created?: boolean
}

export type OpenApiInput = {
  title: string
  version: string
  description?: string
  servers?: { url: string; description?: string }[]
  schemas: Record<string, z.ZodType>
  operations: Operation[]
  /** the schema name of the error envelope, and the statuses it can arrive with */
  error: { schema: string; statuses: readonly number[] }
  /** fixture-only request header, listed on every operation */
  fixture?: { header: string; values: readonly string[] }
}

// JSON Schema's numeric maximum can't constrain an integer *string*, so u64 bounds are spelled
// lexically: any shorter number, then each 20-digit prefix that stays at or under 2^64 - 1.
function u64Pattern(positive: boolean) {
  const max = U64_MAX.toString()
  const options = [positive ? `[1-9][0-9]{0,${max.length - 2}}` : `0|[1-9][0-9]{0,${max.length - 2}}`]
  for (let i = 1; i < max.length; i++) {
    const d = Number(max[i])
    if (d > 0) options.push(`${max.slice(0, i)}[0-${d - 1}][0-9]{${max.length - i - 1}}`)
  }
  options.push(max)
  return `^(?:${options.join('|')})$`
}

function jsonSchema(schema: z.ZodType, io: 'input' | 'output') {
  const json = z.toJSONSchema(schema, {
    io,
    unrepresentable: 'any',
    override: ({ zodSchema, jsonSchema }) => {
      if (zodSchema === U64 || zodSchema === PositiveU64) {
        Object.assign(jsonSchema, { type: 'string', minLength: 1, maxLength: 20, pattern: u64Pattern(zodSchema === PositiveU64) })
      }
    },
  }) as Record<string, unknown>
  delete json.$schema
  return json
}

export function openApiDocument(input: OpenApiInput) {
  const requests = new Set(input.operations.flatMap((o) => (o.request ? [o.request] : [])))
  const ref = (name: string) => {
    if (!input.schemas[name]) throw new Error(`OpenAPI: no schema named ${name}`)
    return { $ref: `#/components/schemas/${name}` }
  }
  const json = (name: string) => ({ 'application/json': { schema: ref(name) } })
  const error = { description: 'The error envelope: branch on error.code.', content: json(input.error.schema) }
  const fixture = input.fixture && {
    in: 'header',
    name: input.fixture.header,
    required: false,
    description: 'Fixture server only: a scenario, or an error code to force that error.',
    schema: { type: 'string', enum: [...input.fixture.values] },
  }

  const paths: Record<string, Record<string, unknown>> = {}
  for (const op of input.operations) {
    const pathParams = [...op.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).map((name) => ({
      in: 'path',
      name,
      required: true,
      schema: op.params?.[name] ? ref(op.params[name]) : { type: 'string' },
    }))
    const query = op.query ? jsonSchema(op.query, 'input') : null
    const required = new Set((query?.required as string[] | undefined) ?? [])
    const queryParams = Object.entries((query?.properties as Record<string, unknown>) ?? {}).map(([name, schema]) => ({
      in: 'query',
      name,
      required: required.has(name),
      schema,
    }))
    paths[op.path] ??= {}
    paths[op.path]![op.method] = {
      operationId: op.operationId,
      summary: op.summary,
      ...(op.description ? { description: op.description } : {}),
      parameters: [...pathParams, ...queryParams, ...(fixture ? [fixture] : [])],
      ...(op.request ? { requestBody: { required: true, content: json(op.request) } } : {}),
      responses: {
        [op.created ? '201' : '200']: { description: 'Success', content: json(op.response) },
        ...Object.fromEntries(input.error.statuses.map((s) => [String(s), error])),
      },
    }
  }

  const schemas = Object.fromEntries(Object.entries(input.schemas).map(([name, s]) => [name, jsonSchema(s, requests.has(name) ? 'input' : 'output')]))
  return {
    openapi: '3.1.0',
    jsonSchemaDialect: 'https://json-schema.org/draft/2020-12/schema',
    info: { title: input.title, version: input.version, ...(input.description ? { description: input.description } : {}) },
    servers: input.servers ?? [],
    paths,
    components: { schemas },
  }
}
