import { ItisWorkspace } from "@/components/itis-workspace";
import { requireCurrentUser } from "@/lib/auth";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export type WorkspaceView = "chat" | "images" | "usage" | "account" | "admin";

export async function WorkspacePage({
  view,
  conversationId = null,
}: {
  view: WorkspaceView;
  conversationId?: string | null;
}) {
  const user = await requireCurrentUser();
  if (view === "images" && user.imageProvider === "disabled") redirect("/chat");
  const sidebarOpen = (await cookies()).get("sidebar_state")?.value !== "false";
  return (
    <ItisWorkspace
      initialView={view}
      initialConversationId={conversationId}
      initialSidebarOpen={sidebarOpen}
      user={{
        userId: user.id,
        displayName: user.name,
        email: user.email,
        fullName: user.name,
        locale: user.locale,
        role: user.role,
        imageProvider: user.imageProvider,
        memoryEnabled: user.memoryEnabled,
        autoMemory: user.autoMemory,
      }}
    />
  );
}
