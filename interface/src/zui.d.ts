declare module "@cypher-asi/zui" {
  import type {
    ReactNode,
    HTMLAttributes,
    ButtonHTMLAttributes,
    InputHTMLAttributes,
    TextareaHTMLAttributes,
    ElementType,
    RefObject,
  } from "react";

  // Theme
  export type Theme = "dark" | "light" | "system";
  export type ResolvedTheme = "dark" | "light";
  export type AccentColor = "cyan" | "blue" | "purple" | "green" | "orange" | "rose";

  export interface ThemeContextValue {
    theme: Theme;
    accent: AccentColor;
    resolvedTheme: ResolvedTheme;
    systemTheme: ResolvedTheme;
    setTheme: (theme: Theme) => void;
    setAccent: (accent: AccentColor) => void;
  }

  export interface ThemeProviderProps {
    children: ReactNode;
    defaultTheme?: Theme;
    defaultAccent?: AccentColor;
    storageKey?: string;
    forcedTheme?: ResolvedTheme;
    disableTransitionOnChange?: boolean;
  }

  export function ThemeProvider(props: ThemeProviderProps): JSX.Element;
  export function useTheme(): ThemeContextValue;

  // Button
  export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "filled" | "glass" | "transparent";
  export type ButtonSize = "sm" | "md";
  export type ButtonRounded = "none" | "sm" | "md" | "lg" | "full";

  export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    rounded?: ButtonRounded;
    textCase?: "none" | "capitalize" | "uppercase";
    iconOnly?: boolean;
    icon?: ReactNode;
    selected?: boolean;
    selectedBgColor?: string;
    contentStates?: ReactNode[];
    as?: "button" | "span";
  };

  export const Button: React.ForwardRefExoticComponent<ButtonProps & React.RefAttributes<HTMLButtonElement>>;
  export function ButtonPlus(props: ButtonHTMLAttributes<HTMLButtonElement> & { size?: ButtonSize }): JSX.Element;
  export function ButtonCopy(props: ButtonHTMLAttributes<HTMLButtonElement> & { text: string; size?: ButtonSize }): JSX.Element;

  // ButtonWindow
  export type ButtonWindowAction = "minimize" | "maximize" | "close";
  export interface ButtonWindowProps {
    action: ButtonWindowAction;
    onClick?: () => void;
    size?: ButtonSize;
    rounded?: ButtonRounded;
    disabled?: boolean;
    className?: string;
  }
  export function ButtonWindow(props: ButtonWindowProps): JSX.Element;

  // Input
  export type InputSize = "sm" | "md";
  export type InputVariant = "default" | "bare" | "underline";
  export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size"> {
    size?: InputSize;
    variant?: InputVariant;
    mono?: boolean;
    validationMessage?: string;
  }
  export const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>>;

  // Textarea
  export type TextareaSize = "sm" | "md";
  export interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "size"> {
    size?: TextareaSize;
    mono?: boolean;
  }
  export const Textarea: React.ForwardRefExoticComponent<TextareaProps & React.RefAttributes<HTMLTextAreaElement>>;

  // Text
  export type TextVariant = "primary" | "secondary" | "muted";
  export type TextSize = "2xs" | "xs" | "sm" | "base" | "lg" | "xl";
  export type TextWeight = "normal" | "medium" | "semibold";

  export interface TextProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
    children: ReactNode;
    variant?: TextVariant;
    size?: TextSize;
    weight?: TextWeight;
    align?: "left" | "center" | "right";
    as?: ElementType;
  }
  export function Text(props: TextProps): JSX.Element;

  // Heading
  export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
  export interface HeadingProps extends Omit<HTMLAttributes<HTMLHeadingElement>, "children"> {
    children: ReactNode;
    level?: HeadingLevel;
    variant?: "primary" | "secondary";
  }
  export function Heading(props: HeadingProps): JSX.Element;

  // Label
  export type LabelVariant = "default" | "success" | "warning" | "danger" | "info" | "muted";
  export type LabelSize = "xs" | "sm" | "md";
  export interface LabelProps extends HTMLAttributes<HTMLElement> {
    children: ReactNode;
    variant?: LabelVariant;
    size?: LabelSize;
    uppercase?: boolean;
    mono?: boolean;
    border?: boolean;
    as?: ElementType;
  }
  export function Label(props: LabelProps): JSX.Element;

  // Badge
  export type BadgeVariant = "running" | "stopped" | "error" | "pending" | "provisioning";
  export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant: BadgeVariant;
    pulse?: boolean;
  }
  export function Badge(props: BadgeProps): JSX.Element;

  // Spinner
  export interface SpinnerProps extends HTMLAttributes<HTMLDivElement> {
    size?: "sm" | "md" | "lg";
  }
  export function Spinner(props: SpinnerProps): JSX.Element;

  // Panel
  export type PanelVariant = "solid" | "transparent" | "glass";
  export type PanelBackground = "none" | "bg" | "surface" | "elevated";
  export type PanelBorder = "none" | "solid" | "future";

  export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
    variant?: PanelVariant;
    background?: PanelBackground;
    border?: PanelBorder;
    borderRadius?: "none" | "sm" | "md" | "lg" | number;
    focused?: boolean;
    open?: boolean;
    hoverable?: boolean;
    image?: string;
    imageHeight?: string;
  }
  export function Panel(props: PanelProps): JSX.Element;

  // Card
  export type CardProps = HTMLAttributes<HTMLDivElement>;
  export function Card(props: CardProps): JSX.Element;

  export interface CardItemProps {
    selected?: boolean;
    onClick?: () => void;
    iconBadge?: ReactNode;
    title?: ReactNode;
    titleSans?: boolean;
    statusBadge?: ReactNode;
    meta?: ReactNode;
    secondary?: ReactNode;
    badges?: ReactNode;
    actions?: ReactNode;
    actionsAlwaysVisible?: boolean;
    className?: string;
    children?: ReactNode;
  }
  export function CardItem(props: CardItemProps): JSX.Element;

  // Sidebar
  export interface SidebarProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
    children?: ReactNode;
    header?: ReactNode;
    footer?: ReactNode;
    resizable?: boolean;
    minWidth?: number;
    maxWidth?: number;
    defaultWidth?: number;
    storageKey?: string;
    resizePosition?: "left" | "right";
    onWidthChange?: (width: number) => void;
    collapsed?: boolean;
  }
  export function Sidebar(props: SidebarProps): JSX.Element;

  // Topbar
  export interface TopbarProps extends Omit<HTMLAttributes<HTMLElement>, "children"> {
    icon?: ReactNode;
    title?: ReactNode;
    actions?: ReactNode;
  }
  export function Topbar(props: TopbarProps): JSX.Element;

  // Tabs
  export interface Tab {
    id: string;
    label: string;
    icon?: ReactNode;
  }
  export interface TabsProps {
    tabs: Tab[];
    value?: string;
    onChange?: (id: string) => void;
    className?: string;
    tabClassName?: string;
    size?: "sm" | "md";
  }
  export function Tabs(props: TabsProps): JSX.Element;

  // Group
  export interface GroupProps extends Omit<HTMLAttributes<HTMLDivElement>, "children" | "title"> {
    label?: string;
    title?: string;
    count?: number;
    stats?: ReactNode;
    children?: ReactNode;
  }
  export function Group(props: GroupProps): JSX.Element;

  export interface GroupCollapsibleProps extends GroupProps {
    defaultOpen?: boolean;
  }
  export function GroupCollapsible(props: GroupCollapsibleProps): JSX.Element;

  // Item
  export interface ItemProps extends Omit<HTMLAttributes<HTMLButtonElement>, "onClick" | "onKeyDown"> {
    id?: string;
    selected?: boolean;
    active?: boolean;
    disabled?: boolean;
    indent?: number;
    onClick?: (e: React.MouseEvent) => void;
    onKeyDown?: (e: React.KeyboardEvent) => void;
    children?: ReactNode;
    role?: string;
    hasChildren?: boolean;
    expanded?: boolean;
    level?: number;
  }

  interface ItemIconProps extends HTMLAttributes<HTMLSpanElement> {
    children: ReactNode;
  }
  interface ItemLabelProps extends HTMLAttributes<HTMLSpanElement> {
    children: ReactNode;
    secondary?: boolean;
  }
  interface ItemChevronProps {
    expanded?: boolean;
    onToggle?: (e: React.MouseEvent) => void;
    className?: string;
    size?: "sm" | "md";
    showSpacer?: boolean;
  }
  interface ItemActionProps extends HTMLAttributes<HTMLSpanElement> {
    children: ReactNode;
    onClick?: (e: React.MouseEvent) => void;
  }

  export function Item(props: ItemProps): JSX.Element;
  export namespace Item {
    function Icon(props: ItemIconProps): JSX.Element;
    function Label(props: ItemLabelProps): JSX.Element;
    function Chevron(props: ItemChevronProps): JSX.Element;
    function Action(props: ItemActionProps): JSX.Element;
    function Spacer(): JSX.Element;
  }

  // Breadcrumb
  export interface BreadcrumbItem {
    label: string;
    href?: string;
    onClick?: () => void;
  }
  export interface BreadcrumbProps extends HTMLAttributes<HTMLElement> {
    items: BreadcrumbItem[];
    separator?: ReactNode;
  }
  export function Breadcrumb(props: BreadcrumbProps): JSX.Element;

  // Page
  export interface PageProps {
    title?: string;
    subtitle?: ReactNode;
    count?: number;
    actions?: ReactNode;
    isLoading?: boolean;
    loadingText?: string;
    children?: ReactNode;
    className?: string;
  }
  export function Page(props: PageProps): JSX.Element;

  export interface PageHeaderProps extends HTMLAttributes<HTMLDivElement> {
    title?: string;
    subtitle?: ReactNode;
    count?: number | string;
    actions?: ReactNode;
  }
  export function PageHeader(props: PageHeaderProps): JSX.Element;

  export interface PageEmptyStateProps {
    icon?: ReactNode;
    title?: string;
    description?: string;
    actions?: ReactNode;
  }
  export function PageEmptyState(props: PageEmptyStateProps): JSX.Element;

  export function PageList(props: { children: ReactNode }): JSX.Element;
  export function PageLoader(props: { message?: string }): JSX.Element;

  // Modal
  export type ModalSize = "sm" | "md" | "lg" | "xl" | "full";
  export interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    subtitle?: string;
    children?: ReactNode;
    footer?: ReactNode;
    headerActions?: ReactNode;
    size?: ModalSize;
    fullHeight?: boolean;
    noPadding?: boolean;
    className?: string;
    contentClassName?: string;
    initialFocusRef?: RefObject<HTMLElement>;
  }
  export function Modal(props: ModalProps): JSX.Element;

  export interface ModalConfirmProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    title: string;
    message: ReactNode;
    confirmLabel?: string;
    cancelLabel?: string;
    danger?: boolean;
    isLoading?: boolean;
  }
  export function ModalConfirm(props: ModalConfirmProps): JSX.Element;

  // Code
  export interface CodeProps extends HTMLAttributes<HTMLElement> {
    children: ReactNode;
    variant?: "default" | "muted";
  }
  export function Code(props: CodeProps): JSX.Element;

  // Container
  export type ContainerProps = HTMLAttributes<HTMLDivElement>;
  export function Container(props: ContainerProps): JSX.Element;

  // Drawer
  export type DrawerSide = "left" | "right" | "top" | "bottom";
  export interface DrawerProps {
    side: DrawerSide;
    isOpen: boolean;
    onClose: () => void;
    onOpen?: () => void;
    children?: ReactNode;
    title?: string;
    minSize?: number;
    maxSize?: number;
    defaultSize?: number;
    minimizedSize?: number;
    storageKey?: string;
    initialMinimized?: boolean;
    className?: string;
    showMinimizedBar?: boolean;
    minimizedBarContent?: ReactNode;
    showToggle?: boolean;
    transparent?: boolean;
    noBorder?: boolean;
    titleClickable?: boolean;
  }
  export function Drawer(props: DrawerProps): JSX.Element;

  // Navigator
  export interface NavigatorItemProps {
    id: string;
    label: string;
    icon?: ReactNode;
    disabled?: boolean;
  }
  export interface NavigatorProps {
    items: NavigatorItemProps[];
    value?: string;
    onChange?: (id: string) => void;
    className?: string;
    searchable?: boolean;
    searchPlaceholder?: string;
    onSearch?: (query: string) => void;
  }
  export function Navigator(props: NavigatorProps): JSX.Element;

  // Menu
  export type MenuBackground = "none" | "solid" | "transparent" | "glass";
  export type MenuRounded = "none" | "sm" | "md" | "lg";
  export type MenuBorder = "none" | "solid" | "future";

  export interface MenuItemProps {
    id: string;
    label: string;
    icon?: ReactNode;
    status?: ReactNode;
    disabled?: boolean;
    children?: MenuItemProps[];
  }

  export interface MenuSeparator {
    type: "separator";
  }

  export type MenuItem = MenuItemProps | MenuSeparator;

  export interface MenuProps {
    title?: string;
    items: MenuItem[];
    value?: string | string[];
    onChange?: (id: string) => void;
    background?: MenuBackground;
    rounded?: MenuRounded;
    border?: MenuBorder;
    className?: string;
    width?: number | string;
    isOpen?: boolean;
  }

  export function Menu(props: MenuProps): JSX.Element;

  // Explorer
  export interface ExplorerNode {
    id: string;
    label: string;
    icon?: ReactNode;
    suffix?: ReactNode;
    children?: ExplorerNode[];
    metadata?: Record<string, unknown>;
    disabled?: boolean;
  }

  export type DropPosition = "before" | "after" | "inside";

  export interface ExplorerProps {
    data: ExplorerNode[];
    onSelect?: (selectedIds: string[]) => void;
    onExpand?: (nodeId: string, expanded: boolean) => void;
    onDrop?: (draggedId: string, targetId: string, position: DropPosition) => void;
    defaultExpandedIds?: string[];
    defaultSelectedIds?: string[];
    className?: string;
    enableDragDrop?: boolean;
    enableMultiSelect?: boolean;
    expandOnSelect?: boolean;
    searchable?: boolean;
    searchPlaceholder?: string;
    onSearch?: (query: string) => void;
    compact?: boolean;
    chevronPosition?: "left" | "right";
  }

  export function Explorer(props: ExplorerProps): JSX.Element;

  // Toggle
  export type ToggleSize = "sm" | "md";
  export type ToggleVariant = "default" | "accent";

  export interface ToggleProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "size" | "type"> {
    size?: ToggleSize;
    variant?: ToggleVariant;
    label?: string;
    labelPosition?: "left" | "right";
  }

  export const Toggle: React.ForwardRefExoticComponent<ToggleProps & React.RefAttributes<HTMLInputElement>>;

  // Utilities
  export function cn(...args: (string | undefined | null | false)[]): string;

  // useResize
  export type ResizeSide = "left" | "right" | "top" | "bottom";

  export interface UseResizeOptions {
    side: ResizeSide;
    minSize: number;
    maxSize: number;
    defaultSize: number;
    storageKey?: string;
    elementRef: import("react").RefObject<HTMLElement | null>;
    offset?: number;
    enabled?: boolean;
    onResizeStart?: () => void;
    onResize?: (size: number) => void;
    onResizeEnd?: (size: number) => void;
  }

  export interface UseResizeReturn {
    size: number;
    isResizing: boolean;
    handleMouseDown: (e: React.MouseEvent) => void;
    setSize: (size: number) => void;
  }

  export function useResize(options: UseResizeOptions): UseResizeReturn;
}

declare module "@cypher-asi/zui/styles" {}
declare module "@fontsource-variable/inter" {}
