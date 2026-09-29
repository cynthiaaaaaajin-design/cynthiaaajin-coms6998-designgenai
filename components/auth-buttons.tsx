"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export function AuthButton({ logout = false }: { logout?: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function handleClick() {
    setBusy(true);
    setError("");
    try {
      const supabase = createClient();
      if (logout) {
        const { error } = await supabase.auth.signOut({ scope: "local" });
        if (error) throw error;
        router.replace("/");
        router.refresh();
      } else {
        const { error } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: {
            redirectTo: `${window.location.origin}/auth/callback`,
            queryParams: { prompt: "select_account" },
          },
        });
        if (error) throw error;
      }
    } catch {
      setError(
        logout
          ? "Could not log out. Please try again."
          : "Could not start Google login. Please try again.",
      );
      setBusy(false);
    }
  }
  return (
    <div>
      <button
        className={logout ? "button-secondary" : "button-primary"}
        onClick={handleClick}
        disabled={busy}
      >
        {busy ? (
          "Just a moment…"
        ) : logout ? (
          "Log out"
        ) : (
          <>
            <span className="google-mark" aria-hidden="true">
              G
            </span>{" "}
            Continue with Google <span aria-hidden="true">↗</span>
          </>
        )}
      </button>
      {error && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
