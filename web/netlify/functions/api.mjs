export default async (request) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(
    /^\/\.netlify\/functions\/api/,
    "/api"
  );
  const method = request.method.toUpperCase();

  const json = (data, status = 200) =>
    Response.json(data, {
      status,
      headers: {
        "Cache-Control": "no-store"
      }
    });


  // PocketMC bridge: credentials stay on the server, never in browser code.
  // Restrict this bridge to the single site owner configured in Netlify.
  const pocketRoute = path.match(/^\/api\/pocketmc(?:\/(.*))?$/);
  if (pocketRoute) {
    const base = (process.env.POCKETMC_BASE_URL || "").trim().replace(/\/+$/, "");
    const pocketUser = process.env.POCKETMC_USERNAME || "";
    const pocketPass = process.env.POCKETMC_PASSWORD || "";
    const ownerId = process.env.POCKETMC_OWNER_USER_ID || "";
    const supabaseUrl = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").trim().replace(/\/+$/, "");
    const supabaseKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
    const authHeader = request.headers.get("authorization") || "";
    const accessToken = authHeader.match(/^Bearer\s+(.+)$/i)?.[1];

    if (!base || !pocketUser || !pocketPass || !ownerId || !supabaseUrl || !supabaseKey) {
      return json({ error: "PocketMC connection is not configured yet." }, 503);
    }
    let parsedBase;
    try { parsedBase = new URL(base); } catch { return json({ error: "Invalid PocketMC base URL." }, 500); }
    if (parsedBase.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(parsedBase.hostname)) {
      return json({ error: "PocketMC URL must use HTTPS." }, 500);
    }
    if (!accessToken) return json({ error: "Please log in again." }, 401);

    try {
      const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { apikey: supabaseKey, Authorization: `Bearer ${accessToken}` },
      });
      if (!userResponse.ok) return json({ error: "Your login session is invalid. Please sign in again." }, 401);
      const user = await userResponse.json();
      if (!user?.id || user.id !== ownerId) return json({ error: "PocketMC controls are available to the hosting owner only." }, 403);

      const loginResponse = await fetch(`${base}/api/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: pocketUser, password: pocketPass }),
        redirect: "error",
      });
      if (!loginResponse.ok) return json({ error: "PocketMC sign-in failed. Check its sub-user credentials and tunnel URL." }, 502);
      const setCookie = loginResponse.headers.get("set-cookie") || "";
      const cookie = setCookie.split(/,(?=[^;]+=)/)[0].split(";")[0];
      if (!cookie) return json({ error: "PocketMC did not return a session cookie." }, 502);

      const route = (pocketRoute[1] || "").split("/").filter(Boolean);
      let upstreamPath = "/api/instances";
      let upstreamMethod = "GET";
      if (route.length === 1 && route[0] === "status") upstreamPath = "/api/status";
      else if (route.length === 1 && route[0] === "instances") upstreamPath = "/api/instances";
      else if (route.length === 3 && route[0] === "instances" && /^[A-Za-z0-9-]{1,100}$/.test(route[1]) && ["start", "stop", "restart"].includes(route[2]) && method === "POST") {
        upstreamPath = `/api/instances/${encodeURIComponent(route[1])}/${route[2]}`;
        upstreamMethod = "POST";
      } else return json({ error: "PocketMC route not found." }, 404);

      const upstream = await fetch(`${base}${upstreamPath}`, {
        method: upstreamMethod,
        headers: { Cookie: cookie, ...(upstreamMethod === "POST" ? { "Content-Type": "application/json" } : {}) },
        ...(upstreamMethod === "POST" ? { body: "{}" } : {}),
        redirect: "error",
      });
      const text = await upstream.text();
      let data;
      try { data = text ? JSON.parse(text) : { success: upstream.ok }; }
      catch { data = { message: text.slice(0, 1000) }; }
      if (!upstream.ok) return json({ error: data?.message || data?.error || `PocketMC returned ${upstream.status}.` }, upstream.status >= 400 && upstream.status < 500 ? upstream.status : 502);
      return json(data);
    } catch {
      return json({ error: "Could not reach PocketMC. Check that its remote-control tunnel is online." }, 502);
    }
  }

  // Health check
  if (method === "GET" && path.endsWith("/health")) {
    return json({
      name: "Alhassan Hosting",
      status: "online"
    });
  }

  // Minecraft Java versions
  if (method === "GET" && path.endsWith("/versions")) {
    try {
      const response = await fetch(
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json"
      );

      if (!response.ok) {
        return json({
          error: "Could not load Minecraft versions"
        }, 502);
      }

      const data = await response.json();

      return json({
        java: data.versions
          .filter((v) => v.type === "release")
          .map((v) => v.id),
        source: "Mojang"
      });
    } catch {
      return json({
        error: "Could not load Minecraft versions"
      }, 502);
    }
  }

  // Registration route
  if (
    method === "POST" &&
    path.endsWith("/auth/register")
  ) {
    return json({
      error: "Registration requires a connected database."
    }, 503);
  }

  // Login route
  if (
    method === "POST" &&
    path.endsWith("/auth/login")
  ) {
    return json({
      error: "Login requires a connected database."
    }, 503);
  }

  // Current user
  if (
    method === "GET" &&
    path.endsWith("/auth/me")
  ) {
    return json({
      error: "Not logged in"
    }, 401);
  }

  // Logout
  if (
    method === "POST" &&
    path.endsWith("/auth/logout")
  ) {
    return json({
      success: true
    });
  }

  // Server API routes
  if (path.includes("/servers")) {
    return json({
      error: "Server management requires a connected database and backend."
    }, 503);
  }

  return json({
    error: "API route not found",
    path,
    method
  }, 404);
};