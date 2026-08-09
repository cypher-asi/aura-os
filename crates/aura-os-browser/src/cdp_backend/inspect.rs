//! DOM inspection helpers for Preview Design mode.
//!
//! Inspection runs inside the target page so it works for every framework
//! and does not require the previewed project to install an Aura runtime.
//! React development metadata is collected opportunistically when a fiber
//! exposes it; the DOM selector remains the universal fallback.

use chromiumoxide::Page;

use crate::error::Error;
use crate::protocol::DesignElement;

/// Return a compact, agent-ready snapshot of the element at `(x, y)`.
pub(super) async fn inspect_element(
    page: &Page,
    x: f32,
    y: f32,
) -> Result<Option<DesignElement>, Error> {
    let script = format!(
        r#"() => {{
          const x = {x};
          const y = {y};
          const element = document.elementFromPoint(x, y);
          if (!(element instanceof Element)) return null;

          const compact = (value, limit) => {{
            const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
            return normalized.length > limit
              ? `${{normalized.slice(0, limit - 1)}}…`
              : normalized;
          }};

          const selectorFor = (node) => {{
            if (node.id) return `#${{CSS.escape(node.id)}}`;
            const parts = [];
            let current = node;
            while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 6) {{
              let part = current.tagName.toLowerCase();
              const usefulClasses = Array.from(current.classList ?? [])
                .filter((name) => name && !name.startsWith("css-"))
                .slice(0, 2);
              if (usefulClasses.length) {{
                part += usefulClasses.map((name) => `.${{CSS.escape(name)}}`).join("");
              }}
              const parent = current.parentElement;
              if (parent) {{
                const siblings = Array.from(parent.children).filter(
                  (child) => child.tagName === current.tagName,
                );
                if (siblings.length > 1) {{
                  part += `:nth-of-type(${{siblings.indexOf(current) + 1}})`;
                }}
              }}
              parts.unshift(part);
              if (parent?.id) {{
                parts.unshift(`#${{CSS.escape(parent.id)}}`);
                break;
              }}
              current = parent;
            }}
            return parts.join(" > ");
          }};

          const componentName = (fiber) => {{
            const type = fiber?.elementType ?? fiber?.type;
            if (!type || typeof type === "string") return null;
            return type.displayName || type.name || null;
          }};

          const normalizeSource = (raw, component) => {{
            if (!raw) return null;
            const fileName = raw.fileName || raw.file || raw.filename;
            if (!fileName) return null;
            let file = String(fileName).replace(/^webpack:\/\//, "");
            try {{
              const parsed = new URL(file, location.href);
              file = decodeURIComponent(parsed.pathname).replace(/^\/@fs\//, "/");
            }} catch {{}}
            return {{
              file,
              line: Number(raw.lineNumber || raw.line || 0) || null,
              column: Number(raw.columnNumber || raw.column || 0) || null,
              component: component || null,
            }};
          }};

          const sourceFromStack = (stack, component) => {{
            if (!stack) return null;
            const text = String(stack.stack || stack);
            const matches = text.matchAll(/(?:https?:\/\/[^\s)]+|\/[^\s)]+\.(?:[cm]?[jt]sx?|vue|svelte)):(\d+):(\d+)/g);
            for (const match of matches) {{
              const full = match[0];
              const suffix = `:${{match[1]}}:${{match[2]}}`;
              let file = full.slice(0, -suffix.length);
              try {{
                const parsed = new URL(file, location.href);
                file = decodeURIComponent(parsed.pathname).replace(/^\/@fs\//, "/");
              }} catch {{}}
              if (file.includes("node_modules")) continue;
              return {{
                file,
                line: Number(match[1]) || null,
                column: Number(match[2]) || null,
                component: component || null,
              }};
            }}
            return null;
          }};

          const reactContext = (node) => {{
            const key = Object.keys(node).find(
              (name) => name.startsWith("__reactFiber$") || name.startsWith("__reactInternalInstance$"),
            );
            let fiber = key ? node[key] : null;
            const componentPath = [];
            let source = null;
            while (fiber) {{
              const name = componentName(fiber);
              if (name && !componentPath.includes(name)) componentPath.push(name);
              if (!source) {{
                source = normalizeSource(fiber._debugSource, name)
                  || normalizeSource(fiber._debugOwner?._debugSource, name)
                  || sourceFromStack(fiber._debugStack, name)
                  || sourceFromStack(fiber._debugOwner?._debugStack, name);
              }}
              fiber = fiber.return;
            }}
            return {{ source, componentPath }};
          }};

          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          const react = reactContext(element);
          return {{
            url: location.href,
            tag_name: element.tagName.toLowerCase(),
            id: element.id || null,
            classes: Array.from(element.classList ?? []).slice(0, 16),
            selector: selectorFor(element),
            text: compact(element.textContent, 320),
            outer_html: compact(element.outerHTML, 2400),
            bounds: {{
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
            }},
            styles: {{
              display: style.display,
              position: style.position,
              color: style.color,
              background_color: style.backgroundColor,
              font_family: style.fontFamily,
              font_size: style.fontSize,
              font_weight: style.fontWeight,
              line_height: style.lineHeight,
              border_radius: style.borderRadius,
              padding: style.padding,
              margin: style.margin,
            }},
            source: react.source,
            component_path: react.componentPath,
          }};
        }}"#
    );

    page.evaluate(script)
        .await
        .map_err(|err| Error::backend("inspect.evaluate", err.to_string()))?
        .into_value::<Option<DesignElement>>()
        .map_err(|err| Error::backend("inspect.deserialize", err.to_string()))
}
