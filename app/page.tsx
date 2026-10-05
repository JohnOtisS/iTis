import { requireChatGPTUser } from "./chatgpt-auth";
import { ItisWorkspace } from "@/components/itis-workspace";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = process.env.NODE_ENV === "development"
    ? { userId: "demo", displayName: "Dũng Nguyễn", email: "dung@itis.ai", fullName: "Dũng Nguyễn" }
    : await requireChatGPTUser("/");
  return <ItisWorkspace user={user} />;
}
