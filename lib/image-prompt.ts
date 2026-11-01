import { LOCAL_AI_BASE_URL, LOCAL_AI_GENERAL_MODEL } from "@/lib/ai-providers";

type LocalChatResponse = {
  choices?: Array<{ message?: { content?: string } }>;
};

const femalePattern = /\b(woman|women|female|girl|lady|her)\b|cô\s*gái|phụ\s*nữ|nữ\s*giới|con\s*gái|thiếu\s*nữ/i;
const malePattern = /\b(man|men|male|boy|gentleman|his)\b|đàn\s*ông|nam\s*giới|con\s*trai|chàng\s*trai/i;
const portraitPattern = /\b(portrait|headshot|close-up|closeup)\b|chân\s*dung|cận\s*cảnh/i;

function cleanModelText(value: string) {
  return value
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/^```(?:text)?\s*|\s*```$/gi, "")
    .replace(/^(prompt|translation)\s*:\s*/i, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

export async function enhanceLocalImagePrompt(originalPrompt: string, signal: AbortSignal) {
  let translated = originalPrompt;
  try {
    const response = await fetch(`${LOCAL_AI_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: LOCAL_AI_GENERAL_MODEL,
        temperature: 0.1,
        max_tokens: 320,
        stream: false,
        messages: [
          {
            role: "system",
            content: "You are an image-prompt translator for Stable Diffusion 1.5. Rewrite the request in concise English. Preserve the exact gender, number of people, subject, clothing, action and composition. Put the main subject first. Add useful photography, lighting and detail terms, but never invent a different person, profession, sport or scene. Vietnamese 'cô gái' means one adult woman. Return only one comma-separated prompt, without commentary or quotation marks.",
          },
          { role: "user", content: originalPrompt },
        ],
      }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
    });
    if (response.ok) {
      const payload = await response.json() as LocalChatResponse;
      const content = cleanModelText(payload.choices?.[0]?.message?.content ?? "");
      if (content.length >= 8) translated = content;
    }
  } catch (error) {
    if (signal.aborted) throw error;
    // Keep image generation available if the local prompt optimizer is offline.
  }

  const asksForFemale = femalePattern.test(originalPrompt);
  const asksForMale = !asksForFemale && malePattern.test(originalPrompt);
  const asksForPortrait = portraitPattern.test(originalPrompt);
  const subjectGuard = asksForFemale
    ? "(one adult woman:1.4), (female:1.35), feminine face, feminine body"
    : asksForMale
      ? "(one adult man:1.4), (male:1.35), masculine face"
      : "";
  const framing = asksForPortrait ? "professional portrait photography, face in focus" : "";
  const positive = [subjectGuard, framing, translated, "accurate subject, coherent anatomy, highly detailed, sharp focus, professional lighting"]
    .filter(Boolean).join(", ");
  const genderNegative = asksForFemale
    ? "male, man, boy, masculine face, beard, mustache, male athlete, soccer player, football player, sports uniform"
    : asksForMale
      ? "female, woman, girl, feminine face"
      : "";
  const negative = [genderNegative, "wrong gender, wrong subject, low quality, blurry, distorted, deformed, bad anatomy, extra limbs, watermark, text"]
    .filter(Boolean).join(", ");

  return { positive, negative };
}
