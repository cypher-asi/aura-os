/**
 * Component Registry - Derives component information from actual file structure
 * 
 * This module automatically discovers components by scanning the file system,
 * preventing sync issues between the component list and actual codebase.
 * 
 * Description priority:
 * 1. README.md in component folder (first paragraph after title)
 * 2. Custom description from componentDescriptions.ts
 * 3. Auto-generated description from component name
 */

import { componentDescriptions } from './componentDescriptions';

export interface ComponentInfo {
  id: string;
  name: string;
  description: string;
  path: string;
  folder: string;
}

// Type for Vite's glob import result
type GlobImportResult = Record<string, string>;

// Discover all component files (PascalCase .tsx files, excluding tests and index)
// Scanning nested structure: src/components/**/[A-Z]*.tsx (supports both flat and nested layouts)
const allComponents = (import.meta as unknown as { 
  glob: (pattern: string, options: Record<string, unknown>) => GlobImportResult 
}).glob(
  '../../../src/components/**/[A-Z]*.tsx',
  { query: '?raw', eager: true, import: 'default' }
);

// Discover README files for descriptions
const readmeFiles = (import.meta as unknown as { 
  glob: (pattern: string, options: Record<string, unknown>) => GlobImportResult 
}).glob(
  '../../../src/components/**/README.md',
  { query: '?raw', eager: true, import: 'default' }
);

/**
 * Extract the first paragraph from a README file as the description
 */
function extractDescriptionFromReadme(readmeContent: string): string | null {
  // Skip the title (# Component Name) and get the first paragraph
  const lines = readmeContent.split('\n');
  let foundTitle = false;
  let description = '';
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    // Skip empty lines before finding content
    if (!trimmed) {
      if (description) break; // End of first paragraph
      continue;
    }
    
    // Skip markdown headers
    if (trimmed.startsWith('#')) {
      foundTitle = true;
      continue;
    }
    
    // Skip if we haven't found the title yet
    if (!foundTitle) continue;
    
    // Accumulate description
    description += (description ? ' ' : '') + trimmed;
  }
  
  return description || null;
}

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
 * Examples:
 *   ../../../src/components/Button/Button.tsx -> Button
 *   ../../../src/components/Code/CodeBlock.tsx -> CodeBlock
 *   ../../../src/components/Nav/NavItem.tsx -> NavItem
 */
function extractComponentName(path: string): string | null {
  // Match ComponentName.tsx (excluding .test.tsx and index.tsx)
  const match = path.match(/\/([A-Z][A-Za-z0-9]+)\.tsx$/);
  if (!match) return null;
  
  const fileName = match[1];
  
  // Skip test files and index files
  if (fileName.includes('.test') || fileName === 'index') {
    return null;
  }
  
  return fileName;
}

/**
 * Extract the immediate parent folder name from component path (for README lookup)
 */
function extractFolderName(path: string): string | null {
  const match = path.match(/\/([A-Z][A-Za-z0-9]+)\/[A-Z][A-Za-z0-9]+\.tsx$/);
  return match ? match[1] : null;
}

/**
 * Extract the top-level component folder from the path (for grouping)
 * Examples:
 *   ../../../src/components/Text/Text/Text.tsx -> Text
 *   ../../../src/components/Text/Textarea/Textarea.tsx -> Text
 *   ../../../src/components/Button/Button/Button.tsx -> Button
 */
function extractTopLevelFolder(path: string): string | null {
  const match = path.match(/\/components\/([A-Z][A-Za-z0-9]+)\//);
  return match ? match[1] : null;
}

/**
 * Generate a sensible default description based on component name
 */
function generateDefaultDescription(name: string): string {
  // Convert PascalCase to words
  const words = name.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return `${name} component for ${words} functionality.`;
}

/**
 * Get description for a component with fallback chain:
 * 1. README content (if provided)
 * 2. Custom description from componentDescriptions
 * 3. Auto-generated description
 */
function getDescription(componentId: string, componentName: string, readmeContent: string | null): string {
  // Priority 1: README content
  if (readmeContent) {
    const readmeDescription = extractDescriptionFromReadme(readmeContent);
    if (readmeDescription) {
      return readmeDescription;
    }
  }
  
  // Priority 2: Custom description override
  if (componentDescriptions[componentId]) {
    return componentDescriptions[componentId];
  }
  
  // Priority 3: Auto-generated
  return generateDefaultDescription(componentName);
}

/**
 * Build the component registry from discovered files
 */
function buildRegistry(): ComponentInfo[] {
  const components: ComponentInfo[] = [];
  const readmeByFolder = new Map<string, string>();
  
  // Index README files by their folder path
  Object.entries(readmeFiles).forEach(([path, content]) => {
    // Extract folder path: ../../../src/components/Avatar/README.md -> Avatar
    const match = path.match(/components\/([A-Z][A-Za-z0-9]+)\/README\.md$/);
    if (match) {
      const [, folder] = match;
      readmeByFolder.set(folder, content as string);
    }
  });
  
  // Process all components
  Object.entries(allComponents).forEach(([path]) => {
    // Skip test files and non-component files
    if (path.includes('.test.') || path.endsWith('index.tsx')) {
      return;
    }
    
    const componentName = extractComponentName(path);
    if (!componentName) return;
    
    // Skip internal files like ExplorerContext
    if (componentName.endsWith('Context')) {
      return;
    }
    
    const componentId = toKebabCase(componentName);
    const folderName = extractFolderName(path);
    const topLevelFolder = extractTopLevelFolder(path);
    const readme = folderName ? readmeByFolder.get(folderName) ?? null : null;
    
    components.push({
      id: componentId,
      name: componentName,
      description: getDescription(componentId, componentName, readme),
      path: path.replace('../../../', '../../zui/'),
      folder: topLevelFolder ?? componentName,
    });
  });
  
  // Sort by name for consistent ordering
  return components.sort((a, b) => a.name.localeCompare(b.name));
}

// Build the registry once at module load time
export const components = buildRegistry();

// Create a lookup map for quick access
export const componentById = new Map(components.map(c => [c.id, c]));

// Log in development mode
if ((import.meta as unknown as { env: { DEV: boolean } }).env.DEV) {
  console.log('[ComponentRegistry] Discovered components:', components.length);
  console.log('[ComponentRegistry] Components:', components.map(c => c.id).sort());
}
