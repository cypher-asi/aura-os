# Existing Server Patch Benchmark

You are working inside an existing Node.js server project.

Update the current `server.js` so that:

- The homepage contains the heading `Aura Patch Complete`.
- The homepage also includes the text `Patched by Aura`.
- Add a `/health` route that returns JSON with `"status":"ok"` and `"source":"patched"`.
- Keep using Node's built-in `http` module with no new dependencies.
- Preserve support for `process.env.PORT`.
- Make sure both `npm run build` and `npm run test` pass.
