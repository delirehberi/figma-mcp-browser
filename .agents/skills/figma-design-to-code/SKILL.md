---
name: figma-design-to-code
description: >-
  Translates live Figma node tree structures (AutoLayout, typography, geometry, fills,
  strokes, and accessibility specs) obtained from the Figma MCP Bridge into high-fidelity,
  responsive frontend components (React, Tailwind CSS, Vue, or HTML/CSS).
---

# Figma Design-to-Code Engineering Skill

Use this skill whenever converting Figma node data retrieved via `get_figma_node` or `get_active_selection` into modern frontend code.

---

## 1. Node Structure & Layout Translation

### Auto-Layout to Flexbox & CSS Grid
Figma's `autoLayout` object maps directly to modern Flexbox and Grid layouts:

| Figma Property | Value | Tailwind CSS Equivalent | CSS Equivalent |
|---|---|---|---|
| `autoLayout.direction` | `"HORIZONTAL"` | `flex flex-row items-center` | `display: flex; flex-direction: row; align-items: center;` |
| `autoLayout.direction` | `"VERTICAL"` | `flex flex-col` | `display: flex; flex-direction: column;` |
| `autoLayout.itemSpacing` | `N` | `gap-[Npx]` (or `gap-2`, `gap-4`) | `gap: Npx;` |
| `autoLayout.padding.left` | `L` | `pl-[Lpx]` | `padding-left: Lpx;` |
| `autoLayout.padding.right` | `R` | `pr-[Rpx]` | `padding-right: Rpx;` |
| `autoLayout.padding.top` | `T` | `pt-[Tpx]` | `padding-top: Tpx;` |
| `autoLayout.padding.bottom`| `B` | `pb-[Bpx]` | `padding-bottom: Bpx;` |

*When `autoLayout` is `null` on a container with multiple children positioned via `dimensions.absoluteBoundingBox`, use a relative container with responsive flex or grid rather than raw absolute pixel values.*

---

## 2. Colors, Fills & Strokes

### Fill Serialization
Figma fills provide RGB integer values (0–255) and float opacity (0–1):
```json
{
  "type": "SOLID",
  "visible": true,
  "opacity": 1,
  "color": { "r": 135, "g": 79, "b": 255, "a": 1 }
}
```

**Conversion Formula**:
- RGBA: `rgba(135, 79, 255, 1)`
- Hex: `#874fff`
- Tailwind Arbitrary: `bg-[#874fff]` or standard palette if matching closely.

### Strokes & Borders
```json
{
  "strokes": [{ "type": "SOLID", "visible": true, "color": { "r": 255, "g": 255, "b": 255, "a": 0.2 } }],
  "strokeWeight": 1,
  "strokeAlign": "INSIDE",
  "cornerRadius": 8
}
```
**Maps to**:
`border border-white/20 rounded-lg` or `border: 1px solid rgba(255, 255, 255, 0.2); border-radius: 8px;`

---

## 3. Typography & Text Hierarchy

Figma `textContext`:
```json
{
  "characters": "Submit Form",
  "fontSize": 16,
  "fontFamily": "Inter",
  "fontWeight": "Semi Bold"
}
```

**Weight Translation**:
- `"Regular"` / `"Normal"`: `font-normal` (400)
- `"Medium"`: `font-medium` (500)
- `"Semi Bold"` / `"SemiBold"`: `font-semibold` (600)
- `"Bold"`: `font-bold` (700)
- `"Extra Bold"`: `font-extrabold` (800)

---

## 4. Accessibility (A11y) & Semantic Roles

The MCP bridge includes an `accessibility` object on normalized nodes:
```json
{
  "accessibility": {
    "inferredRole": "button",
    "description": "Primary action button",
    "annotations": [
      { "label": "Accessibility: Must support Enter/Space activation" }
    ]
  }
}
```

**Implementation Rules**:
1. **Interactive Elements**:
   - `inferredRole === "button"`: Render as native `<button type="button">`, never a clickable `<div>`.
   - `inferredRole === "link"`: Render as `<a href="...">`.
   - `inferredRole === "input"`: Render as `<input>` or `<textarea>` with appropriate `aria-label`.
2. **Headings**:
   - `inferredRole === "heading-1"` -> `<h1>`
   - `inferredRole === "heading-2"` -> `<h2>`
   - `inferredRole === "heading-3"` -> `<h3>`
3. **Containers**:
   - `inferredRole === "dialog"` -> `<dialog>` or `role="dialog"` with `aria-modal="true"`.
   - `inferredRole === "navigation"` -> `<nav>`.

---

## 5. React / Tailwind Code Generation Template

```tsx
import React from "react";

export interface ButtonProps {
  label?: string;
  onClick?: () => void;
  disabled?: boolean;
}

export const ActionButton: React.FC<ButtonProps> = ({
  label = "Submit",
  onClick,
  disabled = false,
}) => {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="inline-flex items-center justify-center px-4 py-3 gap-2 rounded-lg bg-[#874fff] hover:bg-[#7839ee] active:scale-[0.98] text-white font-semibold text-base transition-all duration-150 border border-white/20 focus:outline-none focus:ring-2 focus:ring-[#874fff]/50 disabled:opacity-50 disabled:cursor-not-allowed"
    >
      <span>{label}</span>
    </button>
  );
};
```
