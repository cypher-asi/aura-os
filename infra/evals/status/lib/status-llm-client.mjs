export async function callOpenAiCompatibleJson({
  baseUrl,
  apiKey,
  model,
  messages,
  timeoutMs,
  requestLabel = "Model",
}) {
  if (!baseUrl || !apiKey || !model) {
    throw new Error(`${requestLabel} requires baseUrl, apiKey, and model.`);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${requestLabel} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${requestLabel} request failed with ${response.status}: ${text}`);
    const payload = text ? JSON.parse(text) : null;
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error(`${requestLabel} response did not include message content`);
    }
    return content;
  } finally {
    clearTimeout(timer);
  }
}

export async function callAnthropicTool({
  baseUrl,
  apiKey,
  model,
  messages,
  timeoutMs,
  maxTokens,
  tool,
  requestLabel = "Anthropic model",
}) {
  if (!apiKey || !model) {
    throw new Error(`${requestLabel} requires apiKey and model.`);
  }
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const anthropicMessages = messages
    .filter((message) => message.role !== "system")
    .map((message) => ({
      role: message.role === "assistant" ? "assistant" : "user",
      content: message.content,
    }));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`${requestLabel} timed out after ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/messages`, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        temperature: 0.1,
        ...(system ? { system } : {}),
        messages: anthropicMessages,
        tools: [tool],
        tool_choice: { type: "tool", name: tool.name },
      }),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`${requestLabel} request failed with ${response.status}: ${text}`);
    const payload = text ? JSON.parse(text) : null;
    const toolUse = (payload?.content ?? []).find((block) =>
      block?.type === "tool_use"
        && block.name === tool.name
        && block.input
        && typeof block.input === "object",
    );
    if (toolUse) return toolUse.input;
    const content = (payload?.content ?? [])
      .filter((block) => block?.type === "text" && typeof block.text === "string")
      .map((block) => block.text)
      .join("\n")
      .trim();
    if (!content) throw new Error(`${requestLabel} response did not include text content`);
    return content;
  } finally {
    clearTimeout(timer);
  }
}
