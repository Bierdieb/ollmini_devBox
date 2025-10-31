# CSS Architecture Documentation

**Ollmini Devbox V0.2.0b**

This document explains the CSS architecture, file organization, selector usage, and known issues to help prevent cascading style problems during UI modifications.

---

## File Organization

The CSS is split into **8 modular files** with numeric prefixes for load order:

```
UI/src/styles/
├── 01-base.css          # CSS variables, resets, base typography
├── 02-layout.css        # Main layout structure, app container
├── 03-header.css        # Header, context bars, token counter
├── 04-sidebars.css      # Left sidebar (history) + Right sidebar (pins)
├── 05-chat.css          # Chat messages, input area, streaming
├── 06-markdown.css      # Markdown rendering, syntax highlighting
├── 07-modals.css        # Modals, dialogs, button styles
└── 08-responsive.css    # Media queries, mobile/tablet layouts
```

**CRITICAL:** Files must load in this exact order. Number prefixes (01-08) ensure correct cascade.

---

## CSS Selector Index

### High-Impact Selectors (Defined in Multiple Files)

| Selector | Primary Definition | Secondary Definitions | Components Affected | Known Issues |
|----------|-------------------|----------------------|---------------------|--------------|
| `.input-container` | 05-chat.css:82 | 04-sidebars.css:378-390, 08-responsive.css (lines 37, 63, 96, 162) | Message input area, Sidebar margins, Responsive layout | Changes to margin/padding affect sidebar toggle positioning |
| `.message` | 05-chat.css:1 | 08-responsive.css (multiple) | User/Assistant message bubbles, Tool call displays | Base class for all messages, very broad scope |
| `.main-content` | 02-layout.css:30 | 04-sidebars.css:450, 08-responsive.css (multiple) | Central chat area | Sidebar visibility affects its margins |
| `.header` | 03-header.css:1 | 04-sidebars.css:370, 08-responsive.css (multiple) | Top header bar | Sidebar state changes margins |

### Component-Specific Selectors

#### Chat Messages (05-chat.css, 07-modals.css)
- `.message.user` - User message bubble (blue)
- `.message.assistant` - Assistant message bubble (gray)
- `.message-content` - Text content inside messages
- `.message-actions` - **WARNING: Defined in 07-modals.css:1557 (wrong file!)**
  - Contains Pin/RAG/Copy buttons
  - Should be in 05-chat.css for better organization
  - Applied via JavaScript in message-renderer.js:~150

#### Input Area (05-chat.css)
- `.input-container` - Main wrapper for input area
- `.input-wrapper` - Inner flex container
- `.input-right-section` - Contains send button and toggles
- `#messageInput` - The textarea element

#### Sidebars (04-sidebars.css)
- `.left-sidebar` - Chat history sidebar (left)
- `.pinned-sidebar` - Pinned messages sidebar (right)
- `.sidebar-toggle` - Toggle button for left sidebar
- `.pinned-sidebar-toggle` - Toggle button for right sidebar
- `.pinned-sidebar-visible` - **Class added dynamically to `.main-content` AND `.input-container`**

---

## Load Order Explanation

### Why Numeric Prefixes Matter

1. **01-base.css** - Must load first for CSS variable definitions
2. **02-layout.css** - Defines container structure used by all other files
3. **03-header.css** - Header styles, depends on base layout
4. **04-sidebars.css** - Adds sidebar offsets to elements from 02-layout.css
5. **05-chat.css** - Chat-specific styles, extends layout/sidebar rules
6. **06-markdown.css** - Content styling, must come after message structure
7. **07-modals.css** - Overlay styles, high specificity
8. **08-responsive.css** - Media queries, overrides all previous rules at breakpoints

**Breaking this order will cause visual bugs.**

---

## Known Issues and Gotchas

### 1. `.input-container` Complexity

**Problem:** This class is modified in 4 different files:
- **05-chat.css:82** - Base styles (flex, gap, padding)
- **04-sidebars.css:378-390** - Sidebar margin offsets
- **08-responsive.css** - 23+ responsive adjustments

**Impact:** Changing margin/padding in one file can break:
- Sidebar toggle button positioning
- Responsive layout at breakpoints
- Input area alignment with chat messages

**Recommendation:** Always test with BOTH sidebars open/closed after changes.

---

### 2. `.message-actions` Misplaced

**Problem:** Defined in `07-modals.css:1557` but used for message buttons (not modals).

**Should be:** In `05-chat.css` with other message-related styles.

**Why it matters:** Developers look in chat.css for message styles, not modals.css.

**Future refactoring:** Move to 05-chat.css with scoped selector `.message .message-actions`.

---

### 3. Generic Class Names Without Scoping

**Problem:** Classes like `.message-actions`, `.canvas-toggle-button` are too generic.

**Risk:** Global scope means changes affect ALL elements with that class.

**Better approach:** Use parent selectors:
```css
/* Bad - affects all .message-actions globally */
.message-actions { margin-top: 12px; }

/* Good - only affects message-actions inside .message */
.message .message-actions { margin-top: 12px; }
```

---

### 4. Responsive Breakpoint Overlap

**Breakpoints used:**
- `max-width: 1000px` - Small desktop / large tablet
- `min-width: 900px and max-width: 999px` - Tablet landscape
- `min-width: 768px and max-width: 899px` - Tablet portrait
- `max-width: 767px` - Mobile

**Issue:** `.input-container` rules redefined at EVERY breakpoint.

**Impact:** Hard to predict which styles apply at which screen size.

---

## CSS Variable Usage

### Color Variables (Defined in 01-base.css)

```css
--bg-primary: #1e1e1e;
--text-primary: #e0e0e0;
--user-bubble: #2c5282;
--assistant-bubble: #2d2d2d;
--border-color: #3d3d3d;
```

**Usage:** Always use CSS variables for colors, never hardcode hex values.

### Spacing Variables (Recommendation)

**Currently:** Spacing values are hardcoded (16px, 20px, 8px, etc.)

**Future improvement:** Define spacing variables:
```css
--spacing-xs: 4px;
--spacing-sm: 8px;
--spacing-md: 16px;
--spacing-lg: 24px;
```

---

## Component Ownership Map

| Component | Primary CSS File | JavaScript Module | Notes |
|-----------|-----------------|-------------------|-------|
| Chat Messages | 05-chat.css | message-renderer.js | Also uses 07-modals.css for buttons |
| Input Area | 05-chat.css | renderer.js | Modified by 04-sidebars.css |
| Left Sidebar | 04-sidebars.css | renderer.js | Chat history |
| Right Sidebar | 04-sidebars.css | renderer.js + pin-manager.js | Pinned messages |
| Header | 03-header.css | renderer.js | Token counter, context bars |
| Modals | 07-modals.css | Multiple (settings, rag, file-browser) | Settings, RAG, snapshots |
| Markdown | 06-markdown.css | markdown-renderer.js | Code blocks, syntax highlighting |

---

## Debugging Guide

### Problem: "My CSS change broke an unrelated UI element"

**Common causes:**
1. **Generic selector** - `.input-container` affects multiple elements
2. **Missing parent selector** - `.message-actions` instead of `.message .message-actions`
3. **Responsive override** - Your change works on desktop but 08-responsive.css overrides it
4. **Load order** - Your CSS is in the wrong file and gets overridden

**Solution checklist:**
- [ ] Check if the class is defined in multiple files (use grep)
- [ ] Add parent selector for more specificity
- [ ] Test with sidebars open AND closed
- [ ] Test at all responsive breakpoints
- [ ] Check 08-responsive.css for conflicting media queries

---

### Problem: "I can't find where a style is defined"

**Steps:**
1. Check this document's Selector Index table
2. Use browser DevTools → Inspect → "Computed" tab → See which file sets the property
3. Search all CSS files: `grep -r "classname" UI/src/styles/`
4. Check if it's set dynamically in JavaScript (classList.add)

---

## Refactoring Guidelines

### For New Components

**Use BEM naming convention:**
```css
.block { }              /* Component */
.block__element { }     /* Part of component */
.block__element--modifier { }  /* Variant */
```

**Example:**
```css
/* Instead of: */
.message { }
.message-content { }
.message-actions { }

/* Use: */
.message { }
.message__content { }
.message__actions { }
.message__actions--user { }
```

**Benefits:**
- Self-documenting (clear hierarchy)
- No specificity wars
- Easy to find all related styles

---

### For Existing Components

**Don't break existing code.** Instead:
1. Add new BEM-style classes alongside old ones
2. Deprecate old classes gradually
3. Document both in comments
4. Test thoroughly before removing old classes

---

## Future Improvements

### Phase 2 (Planned): Add Parent Selectors
- Add scoping to prevent global side effects
- Example: `.message-actions` → `.message .message-actions`
- Requires testing to ensure no layout breaks

### Phase 3 (Planned): BEM Refactoring
- Rename classes to BEM convention
- Reorganize CSS by component, not file number
- Possible directory structure:
  ```
  styles/
  ├── base/
  ├── components/
  │   ├── message/
  │   ├── input/
  │   └── sidebar/
  └── layouts/
  ```

---

## Quick Reference: Problem Selectors

If changing these selectors, **test thoroughly**:

1. `.input-container` (affects 4+ UI elements)
2. `.message` (base class for all messages)
3. `.main-content` (central layout container)
4. `.message-actions` (wrong file, broad scope)
5. `.canvas-toggle-button` (affects multiple buttons)

**Always add parent selectors when possible.**

---

**Last Updated:** 2025-10-29
**Version:** 0.2.0b
**Maintainer:** See CLAUDE.md for code-first debugging methodology
