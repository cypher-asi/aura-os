// @vitest-environment node
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { zipSync } from "fflate";
import { pdfToTextFile } from "./research-attachments";

// Node uses PDF.js's real fake-worker implementation, loaded from the same
// shipped worker. Browser verification separately exercises the Vite URL.
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({
  default: pathToFileURL(path.resolve("node_modules/pdfjs-dist/build/pdf.worker.min.mjs")).href,
}));

function researchPdf(): Uint8Array {
  const stream = "BT /F1 18 Tf 72 720 Td (Research attachment fixture) Tj 0 -30 Td (PDF text reaches the research prompt.) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}

it("extracts actual PDF bytes through the real parser and worker", async () => {
  const pdf = researchPdf();
  const result = await pdfToTextFile(new File([new Uint8Array(pdf).buffer], "research.pdf", { type: "application/pdf" }));
  expect(await result.text()).toContain("[Page 1]\nResearch attachment fixture\nPDF text reaches the research prompt.");
  // Optional generated QA artifacts, not source-file edits or user data.
  const fixtureDirectory = process.env.AURA_ATTACHMENT_FIXTURE_DIR;
  if (fixtureDirectory) {
    await writeFile(path.join(fixtureDirectory, "research.pdf"), pdf);
    const png = new Uint8Array(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=", "base64"));
    await writeFile(path.join(fixtureDirectory, "ten-photos.zip"), zipSync(Object.fromEntries(
      Array.from({ length: 10 }, (_, index) => [`photo-${index + 1}.png`, png]),
    )));
  }
});
