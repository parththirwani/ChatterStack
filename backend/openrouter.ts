const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_KEY = process.env.OPENROUTER_KEY!;

export async function createCompletion(
  messages: { role: string; content: string }[],
  model: string,
  cb: (chunk: string) => void
): Promise<string> {
  console.log("📤 Sending to OpenRouter:", {
    model,
    messages,
  });

  const response = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:3000", 
      "X-Title": "ChatterStack",
    },
    body: JSON.stringify({
      model,
      messages,
      stream: true,
    }),
  });

  console.log("🔎 OpenRouter status:", response.status, response.statusText);

  if (!response.ok || !response.body) {
    const errText = await response.text();
    console.error("OpenRouter error:", errText);
    throw new Error(`OpenRouter request failed: ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder("utf-8");

  let fullMessage = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      const lines = chunk.split("\n").filter((line) => line.trim() !== "");

      for (const line of lines) {
        if (line.startsWith("data:")) {
          const data = line.replace("data:", "").trim();
          if (data === "[DONE]") continue;

          try {
            const json = JSON.parse(data);
            const content = json.choices?.[0]?.delta?.content || "";
            if (content) {
              cb(content);
              fullMessage += content;
            }
          } catch (err) {
            console.error("Error parsing JSON line:", line, err);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error streaming OpenRouter:", err);
  }

  console.log("Full assistant message:", fullMessage);
  return fullMessage;
}
