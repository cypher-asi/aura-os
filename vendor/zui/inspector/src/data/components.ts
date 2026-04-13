/**
 * @deprecated This file is deprecated. Import from './componentRegistry' instead.
 * 
 * The component list is now automatically derived from the file system structure
 * to prevent sync issues. See componentRegistry.ts for the implementation.
 * 
 * This file re-exports from componentRegistry for backwards compatibility.
 */

export { 
  components, 
  componentById,
  type ComponentInfo 
} from './componentRegistry';
