/**
 * WVC content compilers
 * - block: replaces wp block comments with compiled wrapper content
 * - shortcode: replaces shortcode text with compiled wrapper content
 */
(() => {
  const block = {
    wrapperIdFromFullToken(fullToken) {
      return fullToken.replace(/"/g, "'");
    },

    fullTokenFromCommentData(data) {
      return "<!--" + data + "-->";
    },

    isWpBlockCommentData(data) {
      return /^\s*\/?wp:\s*\S/.test(data || "");
    },

    parseCommentMeta(data) {
      const raw = (data || "").trim();
      const isClosing = /^\/wp:\s*/.test(raw);
      const openingMatch = raw.match(/^wp:\s*([^\s/][^\s]*)/);
      const closingMatch = raw.match(/^\/wp:\s*([^\s/][^\s]*)/);
      const blockName = openingMatch ? openingMatch[1] : closingMatch ? closingMatch[1] : "";
      const isOpening = !isClosing && /^wp:\s*/.test(raw);
      const isVoid = isOpening && /\/\s*$/.test(raw);
      return { raw, blockName, isOpening, isClosing, isVoid };
    },

    shouldSkipForAncestors(node) {
      let parent = node.parentNode;
      while (parent) {
        const tag = parent.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "WRAPPER") {
          return true;
        }
        parent = parent.parentNode;
      }
      return false;
    },

    findUnusedStoreNode(wrapperId) {
      return document.querySelector(
        `wrapper[id="${CSS.escape(wrapperId)}"]:not([data-processed])`
      );
    },

    materializeNode(storeNode) {
      if (!storeNode || !storeNode.innerHTML.trim()) {
        return null;
      }
      const fragment = document.createDocumentFragment();
      while (storeNode.firstChild) {
        fragment.appendChild(storeNode.firstChild);
      }
      return fragment;
    },

    tryFindWrapper(commentNode) {
      const raw = commentNode.data;
      const variants = [];
      if (raw != null && raw !== "") {
        variants.push(raw);
      }
      const trimmed = typeof raw === "string" ? raw.trim() : "";
      if (trimmed !== "" && trimmed !== raw) {
        variants.push(trimmed);
      }

      for (const d of variants) {
        const full = this.fullTokenFromCommentData(d);
        const wid = this.wrapperIdFromFullToken(full);
        const store = this.findUnusedStoreNode(wid);
        if (store) {
          return store;
        }
      }

      const meta = this.parseCommentMeta(commentNode.data);
      if (meta.isOpening && meta.blockName) {
        const needle = `wp:${meta.blockName}`;
        const stores = document.querySelectorAll("wrapper:not([data-processed])");
        for (const store of stores) {
          const id = store.getAttribute("id") || "";
          if (id.includes(needle)) {
            return store;
          }
        }
      }

      return null;
    },

    findMatchingClosingComment(openCommentNode) {
      const openMeta = this.parseCommentMeta(openCommentNode.data);
      if (!openMeta.isOpening || openMeta.isVoid || !openMeta.blockName) {
        return null;
      }

      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_COMMENT,
        null,
        false
      );
      walker.currentNode = openCommentNode;

      let depth = 1;
      let node;
      while ((node = walker.nextNode())) {
        if (this.shouldSkipForAncestors(node)) {
          continue;
        }
        if (!this.isWpBlockCommentData(node.data)) {
          continue;
        }
        const meta = this.parseCommentMeta(node.data);
        if (meta.blockName !== openMeta.blockName) {
          continue;
        }
        if (meta.isOpening && !meta.isVoid) {
          depth += 1;
          continue;
        }
        if (meta.isClosing) {
          depth -= 1;
          if (depth === 0) {
            return node;
          }
        }
      }
      return null;
    },

    replacePairedRange(openCommentNode, closeCommentNode, renderedNode) {
      if (!openCommentNode.parentNode || !closeCommentNode.parentNode) {
        return false;
      }
      const parent = openCommentNode.parentNode;
      if (parent !== closeCommentNode.parentNode) {
        return false;
      }

      parent.insertBefore(renderedNode, openCommentNode);

      let node = openCommentNode;
      while (node) {
        const next = node.nextSibling;
        parent.removeChild(node);
        if (node === closeCommentNode) {
          break;
        }
        node = next;
      }
      return true;
    },

    processOneComment(commentNode) {
      if (!commentNode.parentNode || !this.isWpBlockCommentData(commentNode.data)) {
        return false;
      }
      const meta = this.parseCommentMeta(commentNode.data);
      if (!meta.isOpening) {
        return false;
      }

      const storeNode = this.tryFindWrapper(commentNode);
      if (!storeNode) {
        return false;
      }

      const renderedNode = this.materializeNode(storeNode);
      if (!renderedNode) {
        return false;
      }

      storeNode.setAttribute("data-processed", "true");
      if (storeNode.parentNode) {
        storeNode.parentNode.removeChild(storeNode);
      }

      if (!meta.isVoid) {
        const closeCommentNode = this.findMatchingClosingComment(commentNode);
        if (closeCommentNode) {
          return this.replacePairedRange(commentNode, closeCommentNode, renderedNode);
        }
      }

      const parent = commentNode.parentNode;
      parent.insertBefore(renderedNode, commentNode);
      parent.removeChild(commentNode);
      return true;
    },

    processAfterRender() {
      setTimeout(() => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_COMMENT,
          null,
          false
        );
        const comments = [];
        let node;
        while ((node = walker.nextNode())) {
          if (!this.isWpBlockCommentData(node.data)) {
            continue;
          }
          if (this.shouldSkipForAncestors(node)) {
            continue;
          }
          const meta = this.parseCommentMeta(node.data);
          if (!meta.isOpening) {
            continue;
          }
          comments.push(node);
        }
        comments.forEach((c) => this.processOneComment(c));
      }, 100);
    },

    init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.processAfterRender());
      } else {
        this.processAfterRender();
      }

      this.observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        mutations.forEach((mutation) => {
          if (mutation.type !== "childList" || mutation.addedNodes.length === 0) {
            return;
          }
          mutation.addedNodes.forEach((added) => {
            if (added.nodeType === Node.COMMENT_NODE) {
              if (this.isWpBlockCommentData(added.data)) {
                shouldProcess = true;
              }
            } else if (added.nodeType === Node.ELEMENT_NODE) {
              if (added.tagName === "WRAPPER") {
                shouldProcess = true;
                return;
              }
              const innerWalker = document.createTreeWalker(
                added,
                NodeFilter.SHOW_COMMENT,
                null,
                false
              );
              let c;
              while ((c = innerWalker.nextNode())) {
                if (this.isWpBlockCommentData(c.data)) {
                  shouldProcess = true;
                  break;
                }
              }
              if (!shouldProcess && added.querySelector("wrapper")) {
                shouldProcess = true;
              }
            }
          });
        });

        if (shouldProcess) {
          setTimeout(() => this.processAfterRender(), 100);
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },
  };

  const shortcode = {
    excludePatterns: [
      /\[CDATA\[.*?\]\]/gi,
      /\/\*.*?\*\//gs,
      /var\s+\w+\s*=\s*\{[^}]*\}/gi,
      /wp\.i18n\.setLocaleData\s*\([^)]*\)/gi,
      /wvcHandlerData\s*=\s*\{[^}]*\}/gi,
      /wpcf7\s*=\s*\{[^}]*\}/gi,
      /"\[a-zA-Z\]"/g,
      /\[\s*[a-zA-Z]\s*\]/g,
      /\[CDATA\[[\s\S]*?\]\]/gi,
      /\/\*[\s\S]*?\*\//g,
      /<script[^>]*>[\s\S]*?<\/script>/gi,
      /<style[^>]*>[\s\S]*?<\/style>/gi,
    ],

    isExcludedContent(text) {
      return this.excludePatterns.some((pattern) => pattern.test(text || ""));
    },

    findUnusedStoreNode(wrapperId) {
      return document.querySelector(
        `wrapper[id="${CSS.escape(wrapperId)}"]:not([data-processed])`
      );
    },

    materializeNode(storeNode) {
      if (!storeNode || !storeNode.innerHTML.trim()) {
        return null;
      }
      const replacement = document.createElement("div");
      replacement.innerHTML = storeNode.innerHTML;
      return replacement;
    },

    replaceInTextNode(shortcodeText, renderedNode, textNode) {
      if (!textNode.parentNode) {
        return;
      }
      const textContent = textNode.textContent;
      let shortcodeIndex = textContent.indexOf(shortcodeText);

      if (shortcodeIndex === -1) {
        const withSingle = shortcodeText.replace(/"/g, "'");
        const withDouble = shortcodeText.replace(/'/g, '"');
        shortcodeIndex = textContent.indexOf(withSingle);
        if (shortcodeIndex !== -1) {
          shortcodeText = withSingle;
        } else {
          shortcodeIndex = textContent.indexOf(withDouble);
          if (shortcodeIndex !== -1) {
            shortcodeText = withDouble;
          }
        }
      }
      if (shortcodeIndex === -1) {
        return;
      }

      const parent = textNode.parentNode;
      const beforeText = textContent.substring(0, shortcodeIndex);
      const afterText = textContent.substring(shortcodeIndex + shortcodeText.length);

      if (beforeText) {
        parent.insertBefore(document.createTextNode(beforeText), textNode);
      }
      parent.insertBefore(renderedNode, textNode);

      if (afterText) {
        const afterNode = document.createTextNode(afterText);
        parent.insertBefore(afterNode, textNode);
        if (afterNode.textContent.match(/\[([a-zA-Z][a-zA-Z0-9_-]*(?:[^[\]]*)?)\]/)) {
          setTimeout(() => this.processInTextNode(afterNode), 200);
        }
      }

      parent.removeChild(textNode);
    },

    processSequentially(shortcodes, textNode, index) {
      if (index >= shortcodes.length) {
        return;
      }
      const shortcodeText = shortcodes[index];
      const wrapperId = shortcodeText.replace(/"/g, "'");
      const storeNode = this.findUnusedStoreNode(wrapperId);
      const renderedNode = this.materializeNode(storeNode);

      if (storeNode && renderedNode) {
        storeNode.setAttribute("data-processed", "true");
        this.replaceInTextNode(shortcodeText, renderedNode, textNode);
      }

      setTimeout(() => {
        if (textNode.parentNode) {
          this.processSequentially(shortcodes, textNode, index + 1);
        }
      }, 50);
    },

    processInTextNode(textNode) {
      if (!textNode || !textNode.textContent) {
        return;
      }
      const content = textNode.textContent;
      if (this.isExcludedContent(content)) {
        return;
      }

      const shortcodePattern = /\[([a-zA-Z][a-zA-Z0-9_-]*)\b[^\]]*\]/g;
      let match;
      const shortcodes = [];
      while ((match = shortcodePattern.exec(content)) !== null) {
        const shortcodeName = match[1];
        const fullMatch = match[0];
        if (this.isExcludedContent(fullMatch)) {
          continue;
        }
        if (
          !shortcodeName.match(/^\d+px$/) &&
          !shortcodeName.match(/^(class|data-|aria-|style|disabled|color|var|url)/) &&
          shortcodeName.length > 1 &&
          !shortcodeName.match(/^[a-zA-Z]$/)
        ) {
          shortcodes.push(fullMatch);
        }
      }
      if (shortcodes.length > 0) {
        this.processSequentially(shortcodes, textNode, 0);
      }
    },

    processAfterRender() {
      setTimeout(() => {
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        const textNodes = [];
        let node;
        while ((node = walker.nextNode())) {
          const text = node.textContent;
          if (this.isExcludedContent(text)) {
            continue;
          }
          let parent = node.parentNode;
          let skipNode = false;
          while (parent) {
            if (
              parent.tagName === "SCRIPT" ||
              parent.tagName === "STYLE" ||
              parent.tagName === "WRAPPER"
            ) {
              skipNode = true;
              break;
            }
            parent = parent.parentNode;
          }
          if (skipNode) {
            continue;
          }

          const shortcodePattern = /\[([a-zA-Z][a-zA-Z0-9_-]*)\b[^\]]*\]/;
          if (shortcodePattern.test(text)) {
            const matches = text.match(/\[([a-zA-Z][a-zA-Z0-9_-]*)/g);
            if (matches) {
              const hasValidShortcode = matches.some((m) => {
                const name = m.substring(1);
                return (
                  !name.match(/^\d+px$/) &&
                  !name.match(/^(class|data-|aria-|style|disabled|color|var|url)/) &&
                  name.length > 1
                );
              });
              if (hasValidShortcode) {
                textNodes.push(node);
              }
            }
          }
        }

        textNodes.forEach((textNode) => this.processInTextNode(textNode));
      }, 100);
    },

    init() {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => this.processAfterRender());
      } else {
        this.processAfterRender();
      }

      this.observer = new MutationObserver((mutations) => {
        let shouldProcess = false;
        mutations.forEach((mutation) => {
          if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
            mutation.addedNodes.forEach((node) => {
              if (node.nodeType === Node.TEXT_NODE && node.textContent) {
                if (node.textContent.match(/\[([a-zA-Z][a-zA-Z0-9_-]*)\b[^\]]*\]/)) {
                  shouldProcess = true;
                }
              } else if (node.nodeType === Node.ELEMENT_NODE) {
                const textContent = node.textContent || node.innerText;
                if (
                  textContent &&
                  textContent.match(/\[([a-zA-Z][a-zA-Z0-9_-]*)\b[^\]]*\]/)
                ) {
                  shouldProcess = true;
                }
              }
            });
          }
        });
        if (shouldProcess) {
          setTimeout(() => this.processAfterRender(), 100);
        }
      });

      this.observer.observe(document.body, {
        childList: true,
        subtree: true,
      });
    },
  };

  const WVCCompiler = {
    block,
    shortcode,
    init() {
      this.shortcode.init();
      this.block.init();
    },
  };

  window.WVCCompiler = WVCCompiler;
  WVCCompiler.init();
})();
