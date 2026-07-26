interface Env {
  ASSETS: {
    fetch(request: Request): Promise<Response>;
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/api/health") {
      return Response.json({ ok: true, service: "mfs", version: "0.1.0" });
    }

    if (url.pathname === "/api/config") {
      return Response.json({
        analysisLocation: "browser",
        analysisSampleRate: 22050,
        maxDurationSeconds: 900,
      });
    }

    return env.ASSETS.fetch(request);
  },
};
