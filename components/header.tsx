import { ArrowIcon } from "@/components/arrow-icon";
import Link from "next/link";
import { AuthButton } from "./auth-buttons";

export function Header({
  signedIn = false,
  active,
}: {
  signedIn?: boolean;
  active?: "trips" | "profile" | "community";
}) {
  return (
    <header className="site-header">
      <Link href="/?welcome=1" className="brand" aria-label="TripSync home">
        <span className="brand-icon" aria-hidden="true">
          <ArrowIcon size={24} />
        </span>
        TripSync<span className="text-teal-600">.</span>
      </Link>
      <nav
        aria-label="Main navigation"
        className="flex items-center gap-4 sm:gap-8"
      >
        <Link href="/community" aria-current={active === "community" ? "page" : undefined}>Community</Link>
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
          <Link href="/#how-it-works" className="text-sm">
            A better way to get away <span aria-hidden="true"><ArrowIcon /></span>
          </Link>
        )}
      </nav>
    </header>
  );
}
