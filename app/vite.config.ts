import { createReadStream, existsSync, statSync } from "node:fs";

// Development only (`npm run dev`, never in a build or the desktop app): GET /__dev_file?path=<absolute path> sends a local model file,
// so a test tab can load a large file without the file picker. Only model file extensions are served.
const devFile = {
  name: "pliable-dev-file",
  apply: "serve" as const,
  configureServer(server: any) {
    server.middlewares.use("/__dev_file", (req: any, res: any) => {
      const path = new URL(req.url, "http://localhost").searchParams.get("path") ?? "";
      if (!/\.(step|stp|stpz|iges|igs|brep|brp|3dm|ifc)$/i.test(path) || !existsSync(path) || !statSync(path).isFile()) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("Content-Type", "application/octet-stream");
      createReadStream(path).pipe(res);
    });
  },
};

export default { plugins: [devFile] };
