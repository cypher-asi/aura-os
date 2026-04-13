/**
 * Component Description Overrides
 * 
 * This file provides custom descriptions for components that don't have README files.
 * These descriptions are used by the component registry when no README.md is found.
 * 
 * To add a description for a new component, simply add an entry with the kebab-case
 * component ID as the key.
 */

export const componentDescriptions: Record<string, string> = {
  // Atomic Components
  'badge': 'Status indicator or label with variants for different states (success, error, warning, etc.).',
  'label': 'Compact inline label for displaying status indicators, tags, or categorical metadata with semantic color variants.',
  'button': 'Clickable button element with multiple variants for different use cases and visual styles.',
  'button-collapsible': 'Chevron toggle button for expand/collapse interactions with direction support.',
  'button-radio': 'Radio button component for selecting a single option from a group.',
  'button-window': 'Icon buttons for window controls: minimize, maximize, and close.',
  'button-more': 'Icon button that opens a dropdown menu for additional actions.',
  'code': 'Inline code snippets with monospace font styling for displaying code within text.',
  'heading': 'Semantic heading component with different levels (h1-h6) and styling options.',
  'input': 'Text input field with size variants and optional monospace font for code or data entry.',
  'search': 'Search input with built-in search icon and optional clear button for inline filtering in lists and navigation.',
  'navigator': 'Navigation list component using unified Item for consistent nav sections.',
  'panel': 'Glass-morphism styled container with configurable borders for windows, dialogs, and floating UI.',
  'select': 'Dropdown selection input for choosing from a list of options.',
  'spinner': 'Loading spinner indicator with multiple size variants.',
  'text': 'Text component with various size, weight, and color options.',
  'textarea': 'Multi-line text input field for longer text content with size variants.',
  'toggle': 'Boolean switch/toggle control with success variant for enabled states.',
  
  // Item Components (Unified)
  'item': 'Composable item component with Icon, Label, Chevron, Action, and Spacer subcomponents for navigation, trees, and menus.',
  'item-detailed': 'Rich item component with icon, label, and description for mega menus, detailed lists, and other contexts requiring descriptive items.',
  'item-context': 'Context provider for managing selection and expansion state across Item lists.',
  
  // Composite Components
  'button-refresh': 'Button with refresh icon and loading state for triggering data refreshes.',
  'button-plus': 'Plus icon button for triggering add/create actions.',
  'card': 'Content container with border and background for grouping related information.',
  'card-item': 'Card for displaying list items with metadata, badges, and action buttons.',
  'code-block': 'Syntax-highlighted code block component for displaying multi-line code.',
  'group': 'Static section header for grouping related content without collapse functionality.',
  'group-collapsible': 'Expandable/collapsible section for hiding and showing grouped content.',
  'drawer': 'Resizable drawer panel that slides in from any side with minimize support.',
  'explorer': 'Tree component for hierarchical data with expand/collapse, multi-selection, and drag & drop.',
  'menu': 'Navigation menu with selectable items, supporting solid, glass, and transparent backgrounds.',
  'menu-dropdown': 'Dropdown menu with items for contextual actions and commands.',
  'menu-mega': 'Mega menu panel with rich items (icon, name, description) arranged in multi-column layouts.',
  'modal': 'Dialog overlay for displaying content above the main page with backdrop and animations.',
  'modal-confirm': 'Confirmation dialog with customizable actions for destructive or important operations.',
  'page': 'Full page layout structure with consistent spacing and styling.',
  'page-empty-state': 'Empty state message with icon, title, message, and call-to-action.',
  'page-header': 'Page header with title, breadcrumbs, tabs, and action buttons.',
  'page-list': 'Data list with search filtering and empty state handling.',
  'page-loader': 'Full-page loading state with centered spinner.',
  'sidebar': 'Navigation sidebar with sections and items.',
  'tabs': 'Tab navigation with smooth animations and optional icons for organizing content.',
  'toasts': 'Toast notification system with success, error, and info variants.',
  
  // Theme System
  'theme': 'Theme provider component with dark/light mode support and customizable accent colors. Includes useTheme hook for accessing and modifying theme settings.',
};

/**
 * Group Description Overrides
 * 
 * Descriptions for component groups (folders containing multiple related components).
 * Keys should match the folder name in lowercase.
 */
export const groupDescriptions: Record<string, string> = {
  'button': 'Button components for user interactions. Includes standard buttons, toggle buttons, window controls, and specialized variants like refresh and collapsible triggers.',
  'card': 'Card components for displaying content in contained, elevated surfaces. Includes basic cards and specialized item cards for list displays.',
  'code': 'Code display components for showing source code. Includes inline code snippets and syntax-highlighted code blocks.',
  'group': 'Grouping components for organizing related content. Includes static group headers and collapsible sections.',
  'item': 'Composable item components for building navigation, trees, and menus. Includes base Item with subcomponents and ItemDetailed for rich items with descriptions.',
  'menu': 'Menu components for navigation and actions. Includes standard navigation menus, dropdown menus for contextual commands, and mega menus for rich multi-column layouts.',
  'modal': 'Modal dialog components for overlaying content. Includes general-purpose modals and confirmation dialogs for important actions.',
  'page': 'Page layout components for structuring application views. Includes page containers, headers, loaders, empty states, and list displays.',
  'text': 'Text components for displaying content. Includes headings, body text, and textarea inputs.',
};
