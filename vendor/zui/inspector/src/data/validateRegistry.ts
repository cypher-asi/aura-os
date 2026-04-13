/**
 * Registry Validation Utilities
 * 
 * These utilities help detect sync issues between the component registry,
 * example files, and source files during development.
 */

import { components, componentById } from './componentRegistry';
import { componentSources, hasComponentSource } from './componentSources';

// Discover all example files
const exampleFiles = (import.meta as unknown as { 
  glob: (pattern: string, options: Record<string, unknown>) => Record<string, unknown> 
}).glob(
  '../components/examples/*Example.tsx',
  { eager: true }
);

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  stats: ValidationStats;
}

export interface ValidationIssue {
  type: 'missing-example' | 'orphan-example' | 'missing-source' | 'orphan-source' | 'missing-readme';
  componentId?: string;
  componentName?: string;
  exampleFile?: string;
  sourceFile?: string;
  message: string;
}

export interface ValidationStats {
  totalComponents: number;
  componentsWithExamples: number;
  componentsWithSources: number;
  componentsWithReadme: number;
  orphanExamples: number;
  orphanSources: number;
}

/**
 * Convert a component ID to the expected example name
 * e.g., "button" -> "buttonExample", "code-block" -> "codeblockExample"
 */
function componentIdToExampleName(id: string): string {
  return id.replace(/-/g, '') + 'Example';
}

/**
 * Extract component ID from example file path
 * e.g., "../components/examples/ButtonExample.tsx" -> "button"
 */
function examplePathToComponentId(path: string): string | null {
  const match = path.match(/\/([A-Z][A-Za-z0-9]+)Example\.tsx$/);
  if (!match) return null;
  
  // Convert PascalCase to kebab-case
  return match[1]
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase();
}

/**
 * Validate the component registry for sync issues
 */
export function validateRegistry(): ValidationResult {
  const issues: ValidationIssue[] = [];
  
  // Create a set of example component IDs (normalized)
  const exampleIds = new Set<string>();
  Object.keys(exampleFiles).forEach(path => {
    const id = examplePathToComponentId(path);
    if (id) {
      exampleIds.add(id);
    }
  });
  
  // Create a set of source component IDs
  const sourceIds = new Set(Object.keys(componentSources));
  
  // Track components with examples and sources
  let componentsWithExamples = 0;
  let componentsWithSources = 0;
  let componentsWithReadme = 0;
  
  // Check each component in the registry
  for (const component of components) {
    // Check if component has an example
    const expectedExampleName = componentIdToExampleName(component.id);
    const hasExample = exampleIds.has(component.id);
    
    if (hasExample) {
      componentsWithExamples++;
    } else {
      issues.push({
        type: 'missing-example',
        componentId: component.id,
        componentName: component.name,
        message: `Component "${component.name}" (${component.id}) has no example file. Expected: ${expectedExampleName}.tsx`,
      });
    }
    
    // Check if component has source code available
    if (hasComponentSource(component.id)) {
      componentsWithSources++;
    } else {
      issues.push({
        type: 'missing-source',
        componentId: component.id,
        componentName: component.name,
        message: `Component "${component.name}" (${component.id}) has no source code loaded.`,
      });
    }
    
    // Check if description is auto-generated (indicates missing README)
    if (component.description.includes('component for') && component.description.endsWith('functionality.')) {
      issues.push({
        type: 'missing-readme',
        componentId: component.id,
        componentName: component.name,
        message: `Component "${component.name}" has no README.md with description.`,
      });
    } else {
      componentsWithReadme++;
    }
  }
  
  // Check for orphan examples (examples without corresponding components)
  let orphanExamples = 0;
  Object.keys(exampleFiles).forEach(path => {
    const id = examplePathToComponentId(path);
    if (id && !componentById.has(id)) {
      // Check if it might be a variant example (e.g., ButtonSizesExample)
      // by checking if any component ID is a prefix
      const isVariant = Array.from(componentById.keys()).some(
        compId => id.startsWith(compId) && id !== compId
      );
      
      if (!isVariant) {
        orphanExamples++;
        issues.push({
          type: 'orphan-example',
          exampleFile: path,
          message: `Example file "${path}" has no corresponding component in registry.`,
        });
      }
    }
  });
  
  // Check for orphan sources (source files loaded but not in registry)
  let orphanSources = 0;
  sourceIds.forEach(sourceId => {
    if (!componentById.has(sourceId)) {
      orphanSources++;
      issues.push({
        type: 'orphan-source',
        sourceFile: sourceId,
        message: `Source code loaded for "${sourceId}" but no component in registry.`,
      });
    }
  });
  
  return {
    valid: issues.length === 0,
    issues,
    stats: {
      totalComponents: components.length,
      componentsWithExamples,
      componentsWithSources,
      componentsWithReadme,
      orphanExamples,
      orphanSources,
    },
  };
}

/**
 * Print validation results to the console
 */
export function printValidationReport(): void {
  const result = validateRegistry();
  
  console.group('[Registry Validation Report]');
  console.log(`Total components: ${result.stats.totalComponents}`);
  console.log(`With source code: ${result.stats.componentsWithSources}/${result.stats.totalComponents}`);
  console.log(`With examples: ${result.stats.componentsWithExamples}/${result.stats.totalComponents}`);
  console.log(`With descriptions: ${result.stats.componentsWithReadme}/${result.stats.totalComponents}`);
  console.log(`Orphan examples: ${result.stats.orphanExamples}`);
  console.log(`Orphan sources: ${result.stats.orphanSources}`);
  
  if (result.issues.length > 0) {
    console.group('Issues:');
    result.issues.forEach(issue => {
      const prefix = issue.type === 'missing-example' ? '⚠️' 
        : issue.type === 'orphan-example' ? '🔍' 
        : issue.type === 'missing-source' ? '📦'
        : issue.type === 'orphan-source' ? '🗂️'
        : issue.type === 'missing-readme' ? '📝'
        : '❓';
      console.log(`${prefix} ${issue.message}`);
    });
    console.groupEnd();
  } else {
    console.log('✅ No issues found!');
  }
  
  console.groupEnd();
}

// Run validation in development mode
if ((import.meta as unknown as { env: { DEV: boolean } }).env.DEV) {
  // Delay to ensure all modules are loaded
  setTimeout(() => {
    printValidationReport();
  }, 100);
}
