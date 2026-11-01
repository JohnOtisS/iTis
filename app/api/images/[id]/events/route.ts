import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { imageGenerations } from "@/db/schema";
import { getCurrentUser } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.imageProvider === "disabled") return new Response("Forbidden", { status: 403 });
  const { id } = await context.params;
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let lastPayload = "";
      try {
        while (!request.signal.aborted) {
          const [record] = await getDb().select().from(imageGenerations)
            .where(and(eq(imageGenerations.id, id), eq(imageGenerations.userId, user.id))).limit(1);
          if (!record) {
            controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: "Không tìm thấy job." })}\n\n`));
            break;
          }
          const payload = JSON.stringify({
            id: record.id,
            status: record.status,
            progress: record.progress,
            stage: record.stage,
            error: record.error,
            model: record.model,
            inputTokens: record.inputTokens,
            outputTokens: record.outputTokens,
            estimatedCostUsd: Number(record.estimatedCostUsd),
            url: record.status === "completed" ? `/api/images/${record.id}/file` : null,
            completedAt: record.completedAt,
          });
          if (payload !== lastPayload) {
            controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
            lastPayload = payload;
          } else {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
          }
          if (record.status !== "processing") break;
          await new Promise((resolve) => setTimeout(resolve, 700));
        }
      } catch (error) {
        if (!request.signal.aborted) {
          const message = error instanceof Error ? error.message : "Mất kết nối tiến trình.";
          controller.enqueue(encoder.encode(`event: error\ndata: ${JSON.stringify({ error: message })}\n\n`));
        }
      } finally {
        try { controller.close(); } catch { /* Client đã ngắt kết nối. */ }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
