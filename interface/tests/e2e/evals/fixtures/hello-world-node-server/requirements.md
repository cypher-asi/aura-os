# Hello World Node Server Benchmark

Build a tiny dependency-free Node.js server for Aura's benchmark suite.

Requirements:

- Create `server.js`.
- Use Node's built-in `http` module only.
- Listen on `process.env.PORT` with a fallback to `3000`.
- Serve `/` with an HTML page containing the heading `Aura Eval Server`.
- Include the text `Built by Aura` on the homepage.
- Serve `/health` with JSON that includes `"status":"ok"` and `"service":"aura-eval"`.
- Keep the project dependency-free and make sure both `npm run build` and `npm run test` pass.
