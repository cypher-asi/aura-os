import { promises as fs } from "node:fs";
import path from "node:path";

function createStaticSiteFiles() {
  return new Map([
    ["package.json", JSON.stringify({
      name: "harness-context-static-site",
      private: true,
      version: "0.0.1",
      scripts: {
        test: "echo \"no tests\"",
      },
    }, null, 2)],
    ["index.html", `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Aura Starter</title>
    <link rel="stylesheet" href="./styles.css" />
  </head>
  <body>
    <main class="page">
      <section class="hero">
        <p class="eyebrow">Aura Starter</p>
        <h1>Ship a clean demo fast.</h1>
        <p class="lede">A tiny static site that is intentionally plain so the coding agent has room to improve it.</p>
        <a class="cta" href="#details">Learn more</a>
      </section>
    </main>
  </body>
</html>
`],
    ["styles.css", `:root {
  color-scheme: light;
  font-family: "Helvetica Neue", Arial, sans-serif;
  color: #14213d;
  background: #f6f7fb;
}

* {
  box-sizing: border-box;
}

body {
  margin: 0;
}

.page {
  min-height: 100vh;
  display: grid;
  place-items: center;
  padding: 48px 20px;
}

.hero {
  max-width: 720px;
  background: white;
  border-radius: 24px;
  padding: 40px;
  box-shadow: 0 20px 60px rgba(20, 33, 61, 0.08);
}

.eyebrow {
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-size: 12px;
  color: #5c677d;
}

.hero h1 {
  margin: 12px 0;
  font-size: 48px;
  line-height: 1.05;
}

.lede {
  font-size: 18px;
  line-height: 1.6;
}

.cta {
  display: inline-block;
  margin-top: 20px;
  padding: 14px 22px;
  border-radius: 999px;
  background: #14213d;
  color: white;
  text-decoration: none;
}
`],
    ["requirements.md", `# Requirements

- Turn this into a better-looking small landing page.
- Keep it as a static site.
- Do not add build tooling.
- Keep the structure easy to understand.
`],
  ]);
}

function createRepoIterationFiles() {
  return new Map([
    ["package.json", JSON.stringify({
      name: "harness-context-repo-iteration",
      private: true,
      version: "0.0.1",
      scripts: {
        test: "echo \"no tests\"",
      },
    }, null, 2)],
  ]);
}

function fixturesRoot(interfaceRoot) {
  return path.join(interfaceRoot, "tests", "e2e", "evals", "fixtures");
}

function fixtureScenario(interfaceRoot, fixtureDirName, definition) {
  return {
    ...definition,
    fixtureDir: path.join(fixturesRoot(interfaceRoot), fixtureDirName),
  };
}

export function getHarnessBenchmarkScenarios(interfaceRoot) {
  return {
    "harness-context-static-site": {
      title: "Harness Context Static Site",
      prompts: [
        "Inspect this small static site project and summarize its current structure. Read the important files first. Do not change any code in this turn.",
        "Implement a stronger landing page. Update the hero copy, add a short three-item features section, and keep the styling simple and clean.",
        "Refine the page without starting over. Add a compact footer, make the CTA copy consistent with the hero, and keep the files tidy.",
        "Summarize exactly which files you changed and the user-visible improvements you made.",
      ],
      createFiles: createStaticSiteFiles,
      expectedTerms: ["footer", "feature", "cta"],
      preferredTools: ["write_file", "edit_file"],
    },
    "harness-context-repo-iteration": {
      title: "Harness Context Repeated Repo Iteration",
      prompts: [
        `Create a small static landing page from scratch in this repo. Use exactly these files: \`index.html\`, \`styles.css\`, \`content.json\`, and \`README.md\`.

Product brief:
- Product name: Aura Launch
- Positioning: an operator for founders and small product teams shipping their first reliable AI workflow
- Tone: confident, clear, practical, not fluffy
- Core promise: help teams move from prototype chaos to a workflow that can actually be repeated

Content requirements:
- A hero with eyebrow, headline, supporting body copy, and one CTA
- A three-item features section
- A short proof or trust section with three proof points
- A compact FAQ with two questions and answers
- A closing CTA area
- A compact footer

Implementation constraints:
- Keep it as a plain static site with no framework and no build tooling
- Put the page structure in \`index.html\`
- Put styling in \`styles.css\`
- Put reusable copy in \`content.json\`
- Put a short project overview and a v0.1 changelog entry in \`README.md\`
- Keep the code readable and avoid overengineering`,
        "Refine the same files without starting over. Tighten the hero message, make the three features feel more operational and less generic, and keep the CTA language consistent.",
        "Iterate again on the same files. Add a short proof section and a compact FAQ. Keep the changes focused and avoid bloating the page.",
        "Make one final polish pass. Refine the CTA and footer, improve the responsive layout a bit, and update README.md with a short changelog section describing the refinements.",
        "Summarize the exact files you changed and the user-visible improvements you made.",
      ],
      createFiles: createRepoIterationFiles,
      expectedTerms: ["footer", "faq", "feature", "proof", "readme"],
      preferredTools: ["write_file", "edit_file"],
    },
    "harness-fixture-static-site": fixtureScenario(
      interfaceRoot,
      "hello-world-static-site",
      {
        title: "Harness Fixture Static Site",
        requiredFiles: ["package.json", "requirements.md"],
        prompts: [
          "Read `requirements.md` and summarize the exact implementation requirements. Do not change any files in this turn.",
          "Implement the required static page exactly as specified in `requirements.md`. Keep the project dependency-free.",
          "Re-read `requirements.md`, verify the required strings are present, and fix anything missing without adding build tooling.",
          "Summarize the files you changed and confirm the required strings are present in the final output.",
        ],
        expectedTerms: ["hello aura", "hello from aura", "tagline"],
        preferredTools: ["read_file", "write_file", "edit_file"],
        validationCommand: {
          command: "node",
          args: ["scripts/validate.js"],
        },
      },
    ),
    "harness-fixture-node-server-patch": fixtureScenario(
      interfaceRoot,
      "existing-node-server-patch",
      {
        title: "Harness Fixture Node Server Patch",
        requiredFiles: ["package.json", "requirements.md", "server.js"],
        prompts: [
          "Read `requirements.md` and inspect the current project files, especially `server.js`. Do not change code in this turn.",
          "Patch the existing server so it satisfies `requirements.md` while keeping the project dependency-free and preserving `process.env.PORT` support.",
          "Re-read `requirements.md`, verify the homepage strings and `/health` route, and make any focused fixes that are still missing.",
          "Summarize the files you changed and the user-visible server behavior that now works.",
        ],
        expectedTerms: ["aura patch complete", "patched by aura", "health"],
        preferredTools: ["read_file", "edit_file", "bash_command"],
        validationCommand: {
          command: "node",
          args: ["scripts/validate.js"],
        },
      },
    ),
    "harness-fixture-repeated-read-summary": fixtureScenario(
      interfaceRoot,
      "repeated-read-summary",
      {
        title: "Harness Fixture Repeated Read Summary",
        requiredFiles: ["package.json", "requirements.md", "reference.md"],
        prompts: [
          "Use the file-reading tools to read `requirements.md` and `reference.md`, then summarize the required deliverable. Do not modify files in this turn.",
          "Create `summary.md` from `reference.md`. Include sections titled `Overview`, `Signals`, and `Checklist`.",
          "Re-read `reference.md` before changing anything else. Refine `summary.md` so it clearly covers cache usage, context pressure, and reliability risks.",
          "Summarize the exact file changes you made and the main themes you carried over from `reference.md`.",
        ],
        expectedTerms: ["cache", "context", "reliability", "checklist"],
        preferredTools: ["read_file", "write_file", "edit_file"],
        validationCommand: {
          command: "node",
          args: ["scripts/validate.js"],
        },
      },
    ),
  };
}

export function getHarnessBenchmarkScenario(interfaceRoot, scenarioId) {
  const scenarios = getHarnessBenchmarkScenarios(interfaceRoot);
  return scenarios[scenarioId] ?? scenarios["harness-context-static-site"];
}

async function copyDirectory(sourceDir, destinationDir) {
  await fs.mkdir(destinationDir, { recursive: true });
  const entries = await fs.readdir(sourceDir, { withFileTypes: true });
  await Promise.all(entries.map(async (entry) => {
    const sourcePath = path.join(sourceDir, entry.name);
    const destinationPath = path.join(destinationDir, entry.name);
    if (entry.isDirectory()) {
      await copyDirectory(sourcePath, destinationPath);
      return;
    }
    await fs.copyFile(sourcePath, destinationPath);
  }));
}

export async function validateHarnessBenchmarkScenario(interfaceRoot, scenario) {
  if (!scenario) {
    throw new Error("Expected a scenario definition.");
  }

  if (scenario.fixtureDir) {
    const requirementsPath = path.join(scenario.fixtureDir, "requirements.md");
    await fs.access(requirementsPath);
    if (scenario.validationCommand?.args?.length) {
      const validationPath = path.join(
        scenario.fixtureDir,
        scenario.validationCommand.args[0],
      );
      await fs.access(validationPath);
    }
  }

  return true;
}

export async function prepareHarnessBenchmarkWorkspace(interfaceRoot, scenario, workspaceDir) {
  await validateHarnessBenchmarkScenario(interfaceRoot, scenario);
  await fs.mkdir(workspaceDir, { recursive: true });

  if (scenario.fixtureDir) {
    await copyDirectory(scenario.fixtureDir, workspaceDir);
  }

  if (typeof scenario.createFiles === "function") {
    const files = scenario.createFiles();
    await Promise.all([...files.entries()].map(([relativePath, content]) =>
      fs.writeFile(path.join(workspaceDir, relativePath), content, "utf8")
    ));
  }
}
