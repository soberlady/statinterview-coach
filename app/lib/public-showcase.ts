export type PublicShowcaseAction =
  | { kind: "allow" }
  | { kind: "block-api" }
  | { kind: "redirect"; location: string };

export function publicShowcaseAction(
  pathname: string,
  enabled: boolean,
): PublicShowcaseAction {
  if (!enabled) return { kind: "allow" };
  if (pathname === "/") return { kind: "redirect", location: "/showcase" };
  if (pathname === "/api/health") return { kind: "allow" };
  if (pathname.startsWith("/api/")) return { kind: "block-api" };
  if (
    pathname === "/interview" ||
    pathname.startsWith("/interview/") ||
    pathname === "/report" ||
    pathname.startsWith("/report/")
  ) {
    return { kind: "redirect", location: "/showcase" };
  }
  return { kind: "allow" };
}
