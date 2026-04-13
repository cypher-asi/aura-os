declare module '*.module.css' {
  const classes: { [key: string]: string };
  export default classes;
}

// Vite environment types
interface ImportMeta {
  glob: <T>(pattern: string, options?: { query?: string; eager?: boolean; import?: string }) => Record<string, T>;
  env: {
    DEV: boolean;
    PROD: boolean;
    MODE: string;
  };
}
