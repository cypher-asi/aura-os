const http = require("node:http");

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`
      <!doctype html>
      <html>
        <head>
          <title>Starter Server</title>
        </head>
        <body>
          <h1>Starter Server</h1>
          <p>This server has not been updated yet.</p>
        </body>
      </html>
    `);
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
  res.end("Not found");
});

server.listen(process.env.PORT || 3000);
