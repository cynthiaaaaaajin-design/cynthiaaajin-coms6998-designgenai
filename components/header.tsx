import Link from "next/link";
import { AuthButton } from "./auth-buttons";

export function Header({
  signedIn = false,
  active,
}: {
  signedIn?: boolean;
  active?: "trips" | "profile";
}) {
  return (
    <header className="site-header">
      <Link href="/" className="brand">
        <span className="brand-icon" aria-hidden="true">
          ↗
        </span>
        TripSync<span className="text-teal-600">.</span>
      </Link>
      <nav
        aria-label="Main navigation"
        className="flex items-center gap-4 sm:gap-8"
      >
        {signedIn ? (
          <>
            <Link
              aria-current={active === "trips" ? "page" : undefined}
              href="/trips"
            >
              My trips
            </Link>
            <Link
              aria-current={active === "profile" ? "page" : undefined}
              href="/profile"
            >
              Profile
            </Link>
            <AuthButton logout />
          </>
        ) : (
          <a href="#how-it-works" className="text-sm">
            A better way to get away <span aria-hidden="true">↗</span>
          </a>
        )}
      </nav>
    </header>
  );
}
