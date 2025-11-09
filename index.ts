/*
* Vencord, a Discord client mod
* Copyright (c) 2025 Vendicated and contributors*
* SPDX-License-Identifier: GPL-3.0-or-later
*/

import definePlugin from "@utils/types";

// Finds the closest parent that matches one of the specified selectors.
// Extend the selectors array to support new clickable regions.
function getUnifiedCopyTarget(target: HTMLElement): HTMLElement | null {
    const selectors = [
        "code.inline",
        "div[class*='embedFieldValue']"
    ];
    for (const selector of selectors) {
        const el = target.closest(selector);
        if (el) return el as HTMLElement;
    }
    return null;
}

// Converts set of HTML tags into markdown
// Anything unknown is treated as plain text
function unifiedCopyToMarkdown(el: HTMLElement): string {
    if (el.className && el.className.includes("hiddenVisually")) return "";
    let text = "";
    el.childNodes.forEach(node => {
        if (node.nodeType === Node.TEXT_NODE) {
            text += node.textContent;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            const child = node as HTMLElement;
            switch (child.tagName) {
                case "CODE":
                    if (child.classList.contains("inline")) {
                        text += `\`${unifiedCopyToMarkdown(child)}\``;
                        break;
                    }
                    text += unifiedCopyToMarkdown(child);
                    break;
                case "STRONG":
                    text += `**${unifiedCopyToMarkdown(child)}**`;
                    break;
                case "A":
                    const href = child.getAttribute("href") || "";
                    text += `[${unifiedCopyToMarkdown(child)}](${href})`;
                    break;
                case "LI":
                    text += `- ${unifiedCopyToMarkdown(child)}\n`;
                    break;
                case "UL":
                case "OL":
                    text += unifiedCopyToMarkdown(child);
                    break;
                default:
                    text += unifiedCopyToMarkdown(child);
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
