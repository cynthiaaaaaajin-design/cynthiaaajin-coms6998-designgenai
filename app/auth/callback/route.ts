import { tripDestination } from "@/lib/auth-destination";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let cookieDestination:string|null=null;
  try {
    const value=request.headers.get('cookie')?.split(';').map(part=>part.trim()).find(part=>part.startsWith('tripsync-auth-next='))?.slice('tripsync-auth-next='.length);
    if(value)cookieDestination=tripDestination(decodeURIComponent(value));
  }catch{/* A malformed return cookie never becomes a redirect destination. */}
  const destination = tripDestination(url.searchParams.get("next"))||cookieDestination;
  function redirectTo(path: string) {
    const response = NextResponse.redirect(new URL(path, url.origin));
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.append('Set-Cookie',`tripsync-auth-next=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${url.protocol==='https:'?'; Secure':''}`);
    return response;
  }
  if (code && !url.searchParams.has("error")) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        // Explicit trip links take priority; normal login checks profile completion.
        if (destination) return redirectTo(destination);
        const { data: profile, error: profileError } = await supabase.from("profiles")
          .select("first_name,last_name").eq("id", user.id).maybeSingle();
        return redirectTo(!profileError && profile?.first_name?.trim() && profile?.last_name?.trim() ? "/trips" : "/profile");
      }
    }
  }
  return redirectTo(`/?auth_error=1${destination ? `&next=${encodeURIComponent(destination)}` : ""}`);
}
