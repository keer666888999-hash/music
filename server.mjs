import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 5173);

const mime = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".svg": "image/svg+xml"
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://localhost:${port}`);
    const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
    const safePath = normalize(pathname).replace(/^[/\\]+/, "").replace(/^(\.\.[/\\])+/, "");
    const filePath = join(root, safePath);
    const file = await stat(filePath);
    if (!file.isFile()) throw new Error("Not a file");

    const contentType = mime[extname(filePath).toLowerCase()] || "application/octet-stream";
    const isCodeAsset = [".html", ".css", ".js", ".json"].includes(extname(filePath).toLowerCase());
    const range = req.headers.range;
    const headers = {
      "Accept-Ranges": "bytes",
      "Cache-Control": isCodeAsset ? "no-cache" : "public, max-age=3600",
      "Content-Type": contentType
    };

    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.writeHead(416, { "Content-Range": `bytes */${file.size}` });
        res.end();
        return;
      }

      const requestedStart = match[1] === "" ? 0 : Number(match[1]);
      const requestedEnd = match[2] === "" ? file.size - 1 : Number(match[2]);
      const start = Math.max(0, requestedStart);
      const end = Math.min(requestedEnd, file.size - 1);

      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= file.size) {
        res.writeHead(416, { "Content-Range": `bytes */${file.size}` });
        res.end();
        return;
      }

      res.writeHead(206, {
        ...headers,
        "Content-Range": `bytes ${start}-${end}/${file.size}`,
        "Content-Length": end - start + 1
      });
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      createReadStream(filePath, { start, end }).pipe(res);
      return;
    }

    res.writeHead(200, { ...headers, "Content-Length": file.size });
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    createReadStream(filePath).pipe(res);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, () => {
  console.log(`幻乐之旅 Demo running at http://localhost:${port}`);
});
