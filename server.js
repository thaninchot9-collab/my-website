// MTTS exam app server — ซ่อน Anthropic API Key ไว้ที่ server, นักเรียนใช้แค่ "รหัสเข้าใช้"
// รัน:  ANTHROPIC_API_KEY=sk-ant-... ACCESS_CODE=รหัสของคุณ node server.js   (Node 18+)
const http = require("http"), fs = require("fs"), path = require("path");
const GKEY = process.env.GEMINI_API_KEY;          // ถ้าตั้งค่านี้ จะใช้ Gemini (มีโควตาฟรี)
const KEY = process.env.ANTHROPIC_API_KEY;
const CODES = (process.env.ACCESS_CODE || "thaninchot67").split(",").map(s => s.trim()).filter(Boolean);
const MODEL = process.env.MODEL || (GKEY ? "gemini-2.5-flash" : "claude-sonnet-4-6");
const PORT = process.env.PORT || 3000;
const LIMIT = +process.env.RATE_PER_MIN || 20;      // คำขอ/นาที/IP
if (!KEY && !GKEY) { console.error("ต้องตั้ง GEMINI_API_KEY หรือ ANTHROPIC_API_KEY"); process.exit(1); }

const hits = new Map();
function limited(ip) {
  const now = Date.now(), a = (hits.get(ip) || []).filter(t => now - t < 60000);
  a.push(now); hits.set(ip, a); return a.length > LIMIT;
}
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type,x-access-code" }); res.end(JSON.stringify(obj)); };

http.createServer(async (req, res) => {
  if (req.method === "OPTIONS") return send(res, 204, {});
  if (req.method === "GET" && (req.url === "/" || req.url.startsWith("/index"))) {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    return fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
  }
  if (req.method !== "POST" || req.url !== "/chat") return send(res, 404, { error: { message: "not found" } });
  if (!CODES.includes(req.headers["x-access-code"])) return send(res, 401, { error: { message: "รหัสเข้าใช้ไม่ถูกต้อง" } });
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  if (limited(ip)) return send(res, 429, { error: { message: "ใช้งานถี่เกินไป" } });
  let body = ""; for await (const c of req) { body += c; if (body.length > 100000) return send(res, 413, { error: { message: "too large" } }); }
  try {
    const { system, messages } = JSON.parse(body);
    const sys = String(system || "").slice(0, 4000);
    if (GKEY) {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": GKEY },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: sys }] },
          contents: messages.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: String(m.content) }] })),
          generationConfig: { maxOutputTokens: 1500 }
        })
      });
      const d = await r.json();
      if (!r.ok) return send(res, r.status, { error: { message: d.error?.message || "upstream error" } });
      return send(res, 200, { text: (d.candidates?.[0]?.content?.parts || []).map(c => c.text || "").join("") });
    }
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: sys, messages })
    });
    const d = await r.json();
    if (!r.ok) return send(res, r.status, { error: { message: d.error?.message || "upstream error" } });
    send(res, 200, { text: (d.content || []).map(c => c.text || "").join("") });
  } catch (e) { send(res, 500, { error: { message: "server error" } }); }
}).listen(PORT, () => console.log("เปิดที่ http://localhost:" + PORT));
