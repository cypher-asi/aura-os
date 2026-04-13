/**
 * Component Source Code Loader
 * 
 * This module automatically loads component source files using Vite's import.meta.glob,
 * ensuring the source code displayed in the inspector matches the actual codebase.
 * 
 * It uses the same discovery pattern as componentRegistry.ts to ensure consistency.
 */

// Type for Vite's glob import result
type GlobImportResult = Record<string, string>;

// Import all component TypeScript files as raw text (excluding test files)
const componentFiles = (import.meta as unknown as { 
  glob: (pattern: string, options: Record<string, unknown>) => GlobImportResult 
}).glob(
  '../../../src/components/**/[A-Z]*.tsx',
  { 
    query: '?raw', 
    eager: true, 
    import: 'default'
  }
);

/**
 * Convert PascalCase to kebab-case
 */
function toKebabCase(str: string): string {
  return str
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Extract component name from file path
 * Handles both patterns:
 *   - Button/Button.tsx -> Button
 *   - Nav/NavItem.tsx -> NavItem
 */
function extractComponentName(path: string): string | null {
  const match = path.match(/\/([A-Z][A-Za-z0-9]+)\.tsx$/);
  if (!match) return null;
  return match[1];
}

/**
 * Check if a file should be included as a component source
 */
function shouldInclude(path: string, componentName: string): boolean {
  // Skip test files
  if (path.includes('.test.')) return false;
  
  // Skip index files
  if (path.endsWith('index.tsx')) return false;
  
  // Skip Context files (internal implementation details)
  if (componentName.endsWith('Context')) return false;
  
  return true;
}

// Create a mapping from component ID to source code
export const componentSources: Record<string, string> = {};

// Process the imported files
Object.entries(componentFiles).forEach(([path, content]) => {
  const componentName = extractComponentName(path);
  if (!componentName) return;
  
  if (!shouldInclude(path, componentName)) return;
  
  const componentId = toKebabCase(componentName);
  componentSources[componentId] = content as string;
});

// Log loaded components in development
if ((import.meta as unknown as { env: { DEV: boolean } }).env.DEV) {
  console.log('[ComponentSources] Loaded sources:', Object.keys(componentSources).length);
  console.log('[ComponentSources] Components:', Object.keys(componentSources).sort());
}

/**
 * Get the source code for a component by its ID
 * @param componentId - The kebab-case component ID (e.g., 'button', 'code-block', 'nav-item')
 * @returns The source code as a string, or a placeholder if not found
 */
export function getComponentSource(componentId: string): string {
  return componentSources[componentId] || `// Source code not available for component: ${componentId}`;
}

/**
 * Check if source code is available for a component
 */
export function hasComponentSource(componentId: string): boolean {
  return componentId in componentSources;
}
