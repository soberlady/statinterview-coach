/** Cloudflare Worker entry point for the vinext-starter template. */
import { handleImageOptimization, DEFAULT_DEVICE_SIZES, DEFAULT_IMAGE_SIZES } from "vinext/server/image-optimization";
import handler from "vinext/server/app-router-entry";
import { publicShowcaseAction } from "../app/lib/public-showcase";

interface Env {
  ASSETS: Fetcher;
  DB: D1Database;
  STATINTERVIEW_PUBLIC_SHOWCASE?: string;
  IMAGES: {
    input(stream: ReadableStream): {
      transform(options: Record<string, unknown>): {
        output(options: { format: string; quality: number }): Promise<{ response(): Response }>;
      };
    };
  };
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
  passThroughOnException(): void;
}

// Image security config. SVG sources with .svg extension auto-skip the
// optimization endpoint on the client side (served directly, no proxy).
// To route SVGs through the optimizer (with security headers), set
// dangerouslyAllowSVG: true in next.config.js and uncomment below:
// const imageConfig: ImageConfig = { dangerouslyAllowSVG: true };

const worker = {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const showcaseAction = publicShowcaseAction(
      url.pathname,
      env.STATINTERVIEW_PUBLIC_SHOWCASE === "1",
    );
    if (showcaseAction.kind === "redirect") {
      return Response.redirect(
        new URL(showcaseAction.location, request.url),
        307,
      );
    }
    if (showcaseAction.kind === "block-api") {
      return Response.json(
        {
          error: {
            code: "PUBLIC_SHOWCASE_READ_ONLY",
            message:
              "The public portfolio demo is read-only. Clone the repository to run the full interview system.",
          },
        },
        { status: 403, headers: { "cache-control": "no-store" } },
      );
    }

    if (url.pathname === "/_vinext/image") {
      const allowedWidths = [...DEFAULT_DEVICE_SIZES, ...DEFAULT_IMAGE_SIZES];
      return handleImageOptimization(request, {
        fetchAsset: (path) => env.ASSETS.fetch(new Request(new URL(path, request.url))),
        transformImage: async (body, { width, format, quality }) => {
          const result = await env.IMAGES.input(body).transform(width > 0 ? { width } : {}).output({ format, quality });
          return result.response();
        },
      }, allowedWidths);
    }

    return handler.fetch(request, env, ctx);
  },
};

export default worker;
