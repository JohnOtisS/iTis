import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getCurrentUser } from "@/lib/auth";
import { getBrandingSettings } from "@/lib/branding";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await getCurrentUser()) redirect("/");
  const branding = await getBrandingSettings();
  return (
    <main className="login-page flex min-h-svh items-center justify-center overflow-hidden px-4 py-6 sm:px-6 lg:px-10">
      <div className="login-ambient login-ambient-one" aria-hidden="true" />
      <div className="login-ambient login-ambient-two" aria-hidden="true" />
      <LoginForm systemLogoUrl={branding.systemLogoUrl} />
    </main>
  );
}
