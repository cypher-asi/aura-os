const EXT_TO_LANG: Record<string, string> = {
  rs: "rust",
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  py: "python",
  rb: "ruby",
  go: "go",
  java: "java",
  kt: "kotlin",
  swift: "swift",
  c: "c",
  cpp: "cpp",
  h: "c",
  hpp: "cpp",
  cs: "csharp",
  css: "css",
  scss: "scss",
  less: "less",
  html: "xml",
  htm: "xml",
  xml: "xml",
  svg: "xml",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  md: "markdown",
  sql: "sql",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  ps1: "powershell",
  dockerfile: "dockerfile",
  makefile: "makefile",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  r: "r",
  dart: "dart",
  ex: "elixir",
  exs: "elixir",
  erl: "erlang",
  hs: "haskell",
  scala: "scala",
  php: "php",
  vue: "xml",
  svelte: "xml",
};

export function langFromPath(filePath: string): string | undefined {
  const name = filePath.split(/[/\\]/).pop() ?? "";
  const lower = name.toLowerCase();

  if (lower === "dockerfile" || lower.startsWith("dockerfile."))
    return "dockerfile";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";

  const dot = name.lastIndexOf(".");
  if (dot === -1) return undefined;
  const ext = name.slice(dot + 1).toLowerCase();
  return EXT_TO_LANG[ext];
}

export function filenameFromPath(filePath: string): string {
  return filePath.split(/[/\\]/).pop() ?? filePath;
}
