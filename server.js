
import http from "node:http";

const PORT = process.env.PORT || 3000;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const CLIENT_API_KEY = process.env.CLIENT_API_KEY;

if (!NVIDIA_API_KEY || !CLIENT_API_KEY) {
  console.error("Faltan NVIDIA_API_KEY o CLIENT_API_KEY");
  process.exit(1);
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    return res.end();
  }

  const path = new URL(req.url, "http://localhost").pathname;

  if (path === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ status: "ok" }));
  }

  if (path !== "/v1/chat/completions" && path !== "/v1/models") {
    res.writeHead(404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Endpoint not found" }));
  }

  const suppliedKey = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  if (suppliedKey !== CLIENT_API_KEY) {
    res.writeHead(401, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Invalid API key" }));
  }

  const isModels = path === "/v1/models";

  if ((isModels && req.method !== "GET") ||
      (!isModels && req.method !== "POST")) {
    res.writeHead(405, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: "Method not allowed" }));
  }

  try {
    let body;

    if (!isModels) {
      const chunks = [];
      let size = 0;

      for await (const chunk of req) {
        size += chunk.length;
        if (size > 10 * 1024 * 1024) {
          res.writeHead(413);
          return res.end("Request too large");
        }
        chunks.push(chunk);
      }

      body = Buffer.concat(chunks);
    }

    const upstream = await fetch(
      `https://integrate.api.nvidia.com${path}`,
      {
        method: isModels ? "GET" : "POST",
        headers: {
          "Authorization": `Bearer ${NVIDIA_API_KEY}`,
          "Content-Type": "application/json",
          "Accept": req.headers.accept || "application/json"
        },
        body
      }
    );

    res.statusCode = upstream.status;
    res.setHeader(
      "Content-Type",
      upstream.headers.get("content-type") || "application/json"
    );
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("X-Accel-Buffering", "no");

    if (upstream.body) {
      for await (const chunk of upstream.body) {
        if (!res.write(chunk)) {
          await new Promise(resolve => res.once("drain", resolve));
        }
      }
    }

    res.end();

  } catch (error) {
    console.error("Proxy error:", error);
    if (!res.headersSent) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "NVIDIA connection failed" }));
    } else {
      res.end();
    }
  }
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`NVIDIA Janitor proxy running on port ${PORT}`);
});
