/*
* Vencord, a Discord client mod
* Copyright (c) 2025 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import definePlugin from "@utils/types";

// Finds the closest parent that matches one of the specified selectors.
// Extend the selectors array to support new clickable regions.
function getUnifiedCopyTarget(target: HTMLElement): HTMLElement | null {
    const selectors = ["code.inline", "div[class*='embedFieldValue']"];
    for (const selector of selectors) {
        const el = target.closest(selector);
        if (el) return el as HTMLElement;
    }
    return null;
}

// Detects Discord spoiler containers
const isSpoilerContainer = (el: HTMLElement): boolean => {
    const cls = el.className || "";
    if (cls.includes("spoiler") || cls.includes("obscured")) return true;
    const role = el.getAttribute("role");
    const aria = (el.getAttribute("aria-label") || "").toLowerCase();
    return role === "button" && aria === "spoiler";
};

// Checks if an element should be hidden from output
const isHidden = (el: HTMLElement): boolean => {
    if (el.className?.includes("hiddenVisually")) return true;
    if (el.getAttribute?.("aria-hidden") === "true") return true;
    if (el.getAttribute?.("style")?.includes("display: none")) return true;
    return false;
};

// Normalizes text to have clean single newline separation
const ensureCleanNewline = (text: string): string => {
    let result = text;
    if (/\n{2,}$/.test(result)) result = result.replace(/\n+$/, "\n");
    if (result && !result.endsWith("\n")) result += "\n";
    return result;
};

// Extracts language identifier from PRE code block
const extractLanguage = (pre: HTMLElement): string => {
    if (pre.classList.contains("vc-shiki-container")) {
        const label = pre.querySelector(".vc-shiki-lang");
        return label ? (label.textContent || "").trim().toLowerCase() : "";
    }
    const codeEl = pre.querySelector("code");
    if (codeEl?.className) {
        return (codeEl.className.split(/\s+/).find(t => !/^hljs$/i.test(t) && !/scrollbar/i.test(t)) || "").toLowerCase();
    }
    return "";
};

// Extracts code body from PRE block (handles both regular and vc-shiki)
const extractCodeBody = (pre: HTMLElement, isShiki: boolean): string => {
    if (isShiki) {
        const rows = Array.from(pre.querySelectorAll(".vc-shiki-table-row"));
        if (rows.length) {
            return rows.map(r => (r.querySelectorAll(".vc-shiki-table-cell")[1]?.textContent || "").replace(/\n+$/, "")).join("\n");
        }
    }
    return (pre.querySelector("code")?.textContent || pre.textContent || "").replace(/\n+$/, "");
};

// Tag handler type used by the default branch of the converter.
type TagHandler = (el: HTMLElement, insideSpoiler: boolean, listDepth: number, accText: string) => string;

// Helper to wrap content with markdown delimiters
const wrapMarkdown = (el: HTMLElement, iSpoiler: boolean, depth: number, delimiter: string): string => {
    const inner = unifiedCopyToMarkdown(el, iSpoiler, depth);
    return `${delimiter}${inner}${delimiter}`;
};

// Helper to ensure newline prefix when needed
const ensureNewlinePrefix = (acc: string): string => (acc && !acc.endsWith("\n")) ? "\n" : "";

// Individual handlers return the markdown fragment for the element.
const TAG_HANDLERS: Record<string, TagHandler> = {
    CODE: (el, iSpoiler, depth) => {
        const inner = unifiedCopyToMarkdown(el, iSpoiler, depth);
        return el.classList.contains("inline") ? `\`${inner}\`` : inner;
    },
    SMALL: (el, iSpoiler, depth, acc) => {
        const inner = unifiedCopyToMarkdown(el, iSpoiler, depth);
        return `${ensureNewlinePrefix(acc)}-# ${inner}`;
    },
    STRONG: (el, iSpoiler, depth) => wrapMarkdown(el, iSpoiler, depth, "**"),
    EM: (el, iSpoiler, depth) => wrapMarkdown(el, iSpoiler, depth, "*"),
    S: (el, iSpoiler, depth) => wrapMarkdown(el, iSpoiler, depth, "~~"),
    U: (el, iSpoiler, depth) => wrapMarkdown(el, iSpoiler, depth, "__"),
    A: (el, iSpoiler, depth) => {
        const inner = unifiedCopyToMarkdown(el, iSpoiler, depth);
        const href = el.getAttribute("href") || "";
        return `[${inner}](${href})`;
    },
    LI: (el, iSpoiler, depth) => {
        const parent = el.parentElement as HTMLElement | null;
        const inner = unifiedCopyToMarkdown(el, iSpoiler, depth);
        const indent = "  ".repeat(Math.max(0, depth - 1));
        let marker = "-";
        if (parent && parent.tagName === "OL") {
            const startAttr = parent.getAttribute("start");
            const start = startAttr ? (parseInt(startAttr, 10) || 1) : 1;
            const items = Array.from(parent.children).filter(n => (n as HTMLElement).tagName === "LI");
            const idx = items.indexOf(el);
            const num = start + Math.max(0, idx);
            marker = `${num}.`;
        }
        return `${indent}${marker} ${inner}${inner.endsWith("\n") ? "" : "\n"}`;
    },
    UL: (el, iSpoiler, depth, acc) => 
        ensureNewlinePrefix(acc) + unifiedCopyToMarkdown(el, iSpoiler, depth + 1),
    OL: (el, iSpoiler, depth, acc) => 
        ensureNewlinePrefix(acc) + unifiedCopyToMarkdown(el, iSpoiler, depth + 1),
    IMG: (el) => el.getAttribute("alt") || ""
};

// Alias duplicate tags to their primary handlers
Object.assign(TAG_HANDLERS, {
    I: TAG_HANDLERS.EM,
    DEL: TAG_HANDLERS.S
});

// Converts set of HTML tags into markdown
// Anything unknown is treated as plain text
function unifiedCopyToMarkdown(el: HTMLElement, insideSpoiler = false, listDepth = 0): string {
    if (!insideSpoiler && isHidden(el)) return "";
    
    let text = "";
    el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
            return;
        }
        
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        
        const child = node as HTMLElement;
        
        // Handle spoilers
        if (isSpoilerContainer(child) && !insideSpoiler) {
            text += `||${unifiedCopyToMarkdown(child, true, listDepth)}||`;
            return;
        }
        
        // Handle specific tags with switch
        switch (child.tagName) {
            case "BLOCKQUOTE": {
                const inner = unifiedCopyToMarkdown(child, insideSpoiler, listDepth).replace(/\n+$/, "");
                text = ensureCleanNewline(text);
                text += inner.split("\n").map(l => `> ${l}`).join("\n") + "\n";
                break;
            }
            case "PRE": {
                const isShiki = child.classList.contains("vc-shiki-container");
                text = ensureCleanNewline(text);
                text += `\`\`\`${extractLanguage(child)}\n${extractCodeBody(child, isShiki)}\n\`\`\``;
                break;
            }
            default: {
                const handler = TAG_HANDLERS[child.tagName];
                text += handler 
                    ? handler(child, insideSpoiler, listDepth, text)
                    : unifiedCopyToMarkdown(child, insideSpoiler, listDepth);
            }
        }
    });
    return text;
}

// Visual feedback: temporary background & floating "Copied!" tooltip.
// Restores inline background state exactly (value + !important) after timeout.
function showUnifiedCopyFeedback(element: HTMLElement, x: number, y: number) {
    // Highlight: Add temporary background color - without deleting original style
    const prevBgValue = element.style.getPropertyValue("background-color");
    const prevBgPriority = element.style.getPropertyPriority("background-color");
    element.dataset.ucPrevBg = prevBgValue;
    if (prevBgPriority) element.dataset.ucPrevBgPrio = prevBgPriority;
    element.style.setProperty("background-color", "rgba(150,150,200,0.25)", "important");

    setTimeout(() => {
        const stored = element.dataset.ucPrevBg || "";
        const prio = element.dataset.ucPrevBgPrio || "";
        if (stored) {
            element.style.setProperty("background-color", stored, prio);
        } else {
            element.style.removeProperty("background-color");
        }
        delete element.dataset.ucPrevBg;
        delete element.dataset.ucPrevBgPrio;
    }, 800);

    // Tooltip
    const tooltip = document.createElement("div");
    tooltip.innerText = "Copied!";
    Object.assign(tooltip.style, {
        position: "fixed",
        left: `${x + 10}px`,
        top: `${y + 10}px`,
        background: "#5865F2",
        color: "#fff",
        padding: "2px 6px",
        borderRadius: "4px",
        fontSize: "12px",
        fontWeight: "bold",
        pointerEvents: "none",
        zIndex: "99999",
        opacity: "0",
        transition: "opacity 0.2s ease, transform 0.2s ease",
    });
    document.body.appendChild(tooltip);
    requestAnimationFrame(() => {
        tooltip.style.opacity = "1";
        tooltip.style.transform = "translateY(-5px)";
    });
    setTimeout(() => {
        tooltip.style.opacity = "0";
        tooltip.style.transform = "translateY(-10px)";
        setTimeout(() => tooltip.remove(), 200);
    }, 800);
}

// Plugin definition
export default definePlugin({
    name: "UnifiedCopy",
    description: "Brings Discord's mobile-style copying to desktop",
    authors: [{ name: "Lone Destroyer", id: 208289254823034880n }],
    _unifiedCopyListener: null as EventListener | null,

    start() {
        const container = document.querySelector("#app-mount") || document.body;
        this._unifiedCopyListener = (e: Event) => {
            if (!(e instanceof MouseEvent)) return;
            const target = e.target as HTMLElement | null;
            if (!target) return;
            const element = getUnifiedCopyTarget(target);
            if (!element) return;
            e.preventDefault();
            e.stopPropagation();
            const markdownText = unifiedCopyToMarkdown(element).trim();
            if (!markdownText) return;
            navigator.clipboard.writeText(markdownText).catch(console.error);
            showUnifiedCopyFeedback(element, e.clientX, e.clientY);
        };
        container.addEventListener("click", this._unifiedCopyListener, true);
    },

    stop() {
        const container = document.querySelector("#app-mount") || document.body;
        if (this._unifiedCopyListener) {
            container.removeEventListener("click", this._unifiedCopyListener, true);
            this._unifiedCopyListener = null;
        }
    }
});
