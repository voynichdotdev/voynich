export const OPENAI_DEFAULT_BASE_URL = 'http://127.0.0.1:8787/v1'

export type OpenAISnippetTab = 'cli' | 'js' | 'python' | 'curl'

export const OPENAI_SNIPPET_TABS: readonly { id: OpenAISnippetTab; label: string }[] = [
  { id: 'cli', label: 'CLI' },
  { id: 'js', label: 'JS' },
  { id: 'python', label: 'Python' },
  { id: 'curl', label: 'cURL' },
]

export type OpenAISnippetModel = {
  address: string
  name?: string | null
  slug?: string | null
  inputKind?: 'sketch' | 'tensor' | 'text'
  priceUnit?: 'call' | 'token'
  pricingMode?: 'call' | 'token'
  manifest?: { inputKind?: 'sketch' | 'tensor' | 'text' } | null
}

export function openAIModelId(model: OpenAISnippetModel): string {
  const slug = model.slug?.trim()
  if (slug) return slug
  const name = model.name?.trim()
  if (name) return name
  return model.address
}

export function isMeteredTextModel(model: OpenAISnippetModel): boolean {
  const kind = model.inputKind ?? model.manifest?.inputKind
  const unit = model.priceUnit ?? model.pricingMode
  return kind === 'text' && unit === 'token'
}

export function serveCliSnippet(port = 8787): string {
  return [
    `voynich serve --keypair ./caller.json --port ${port}`,
    `# Optional: --session <pda> --delegate ./delegate.json --pass <pda> --referrer <wallet> --strategy fastest`,
  ].join('\n')
}

export function jsOpenAISnippet(
  model: OpenAISnippetModel,
  baseUrl = OPENAI_DEFAULT_BASE_URL,
): string {
  const id = openAIModelId(model)
  const streaming = isMeteredTextModel(model)
  if (streaming) {
    return [
      `import OpenAI from "openai";`,
      ``,
      `const client = new OpenAI({`,
      `  apiKey: "voynich",`,
      `  baseURL: "${baseUrl}",`,
      `});`,
      ``,
      `const { data: stream, response } = await client.chat.completions`,
      `  .create({`,
      `    model: "${id}",`,
      `    stream: true,`,
      `    messages: [{ role: "user", content: "Explain sealed inference in one sentence." }],`,
      `  })`,
      `  .withResponse();`,
      ``,
      `for await (const chunk of stream) {`,
      `  process.stdout.write(chunk.choices[0]?.delta?.content ?? "");`,
      `}`,
      `console.log("\\nReceipt:", response.headers.get("x-voynich-receipt"));`,
      `console.log("Verify:", response.headers.get("x-voynich-verify-url"));`,
    ].join('\n')
  }
  return [
    `import OpenAI from "openai";`,
    ``,
    `const client = new OpenAI({`,
    `  apiKey: "voynich",`,
    `  baseURL: "${baseUrl}",`,
    `});`,
    ``,
    `const { data, response } = await client.chat.completions`,
    `  .create({`,
    `    model: "${id}",`,
    `    messages: [{ role: "user", content: "Run sealed inference." }],`,
    `  })`,
    `  .withResponse();`,
    ``,
    `console.log(data.choices[0]?.message?.content);`,
    `console.log("Receipt:", response.headers.get("x-voynich-receipt"));`,
    `console.log("Verify:", response.headers.get("x-voynich-verify-url"));`,
  ].join('\n')
}

export function pythonOpenAISnippet(
  model: OpenAISnippetModel,
  baseUrl = OPENAI_DEFAULT_BASE_URL,
): string {
  const id = openAIModelId(model)
  const streaming = isMeteredTextModel(model)
  if (streaming) {
    return [
      `from openai import OpenAI`,
      ``,
      `client = OpenAI(api_key="voynich", base_url="${baseUrl}")`,
      ``,
      `raw = client.chat.completions.with_raw_response.create(`,
      `    model="${id}",`,
      `    stream=True,`,
      `    messages=[{"role": "user", "content": "Explain sealed inference in one sentence."}],`,
      `)`,
      `for chunk in raw.parse():`,
      `    print(chunk.choices[0].delta.content or "", end="", flush=True)`,
      `print("\\nReceipt:", raw.headers.get("x-voynich-receipt"))`,
      `print("Verify:", raw.headers.get("x-voynich-verify-url"))`,
    ].join('\n')
  }
  return [
    `from openai import OpenAI`,
    ``,
    `client = OpenAI(api_key="voynich", base_url="${baseUrl}")`,
    ``,
    `raw = client.chat.completions.with_raw_response.create(`,
    `    model="${id}",`,
    `    messages=[{"role": "user", "content": "Run sealed inference."}],`,
    `)`,
    `completion = raw.parse()`,
    `print(completion.choices[0].message.content)`,
    `print("Receipt:", raw.headers.get("x-voynich-receipt"))`,
    `print("Verify:", raw.headers.get("x-voynich-verify-url"))`,
  ].join('\n')
}

export function curlOpenAISnippet(
  model: OpenAISnippetModel,
  baseUrl = OPENAI_DEFAULT_BASE_URL,
): string {
  const id = openAIModelId(model)
  const streaming = isMeteredTextModel(model)
  const payload = streaming
    ? `{"model":"${id}","stream":true,"messages":[{"role":"user","content":"Explain sealed inference in one sentence."}]}`
    : `{"model":"${id}","messages":[{"role":"user","content":"Run sealed inference."}]}`
  return [
    `curl -i ${streaming ? '-N ' : ''}${baseUrl}/chat/completions \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '${payload}'`,
    `# Response headers include X-Voynich-Receipt and X-Voynich-Verify-Url`,
  ].join('\n')
}

export function buildOpenAISnippets(
  model: OpenAISnippetModel,
  baseUrl = OPENAI_DEFAULT_BASE_URL,
): Record<OpenAISnippetTab, string> {
  return {
    cli: serveCliSnippet(),
    js: jsOpenAISnippet(model, baseUrl),
    python: pythonOpenAISnippet(model, baseUrl),
    curl: curlOpenAISnippet(model, baseUrl),
  }
}
