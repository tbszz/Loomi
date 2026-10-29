import React from "react";

export function SafeMarkdown({ text }) {
  const blocks = parseBlocks(String(text || ""));
  if (!blocks.length) return null;
  return blocks.map((block, index) => renderBlock(block, index));
}

function parseBlocks(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let code = null;

  function flushParagraph() {
    if (paragraph.length) {
      blocks.push({ type: "paragraph", text: paragraph.join("\n") });
      paragraph = [];
    }
  }

  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (/^```/.test(line.trim())) {
      if (code) {
        blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else {
        flushParagraph();
        code = [];
      }
      index += 1;
      continue;
    }
    if (code) {
      code.push(line);
      index += 1;
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      index += 1;
      continue;
    }
    if (isHorizontalRule(line)) {
      flushParagraph();
      blocks.push({ type: "hr" });
      index += 1;
      continue;
    }
    if (isTableStart(lines, index)) {
      flushParagraph();
      const table = readTable(lines, index);
      blocks.push(table.block);
      index += table.consumed;
      continue;
    }
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      blocks.push({ type: heading[1].length === 2 ? "h2" : "h3", text: heading[2].trim() });
      index += 1;
      continue;
    }
    const unordered = line.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      appendList(blocks, "ul", unordered[1]);
      index += 1;
      continue;
    }
    const ordered = line.match(/^(\d+)[.)]\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      appendList(blocks, "ol", ordered[2], Number(ordered[1]));
      index += 1;
      continue;
    }
    paragraph.push(line);
    index += 1;
  }
  if (code) blocks.push({ type: "code", text: code.join("\n") });
  flushParagraph();
  return blocks;
}

function appendList(blocks, type, text, start = null) {
  const last = blocks.at(-1);
  if (last?.type === type) last.items.push(text);
  else blocks.push({ type, items: [text], start: start && start !== 1 ? start : null });
}

function renderBlock(block, key) {
  if (block.type === "h2") return React.createElement("h2", { key }, renderInline(block.text));
  if (block.type === "h3") return React.createElement("h3", { key }, renderInline(block.text));
  if (block.type === "code") return React.createElement("pre", { key }, React.createElement("code", null, block.text));
  if (block.type === "hr") return React.createElement("hr", { key });
  if (block.type === "table") {
    return React.createElement("div", { key, className: "markdown-table" },
      React.createElement("table", null,
        React.createElement("thead", null,
          React.createElement("tr", null, block.headers.map((cell, index) => React.createElement("th", { key: index }, renderInline(cell))))
        ),
        React.createElement("tbody", null,
          block.rows.map((row, rowIndex) => React.createElement("tr", { key: rowIndex },
            row.map((cell, cellIndex) => React.createElement("td", { key: cellIndex }, renderInline(cell)))
          ))
        )
      )
    );
  }
  if (block.type === "ul") {
    return React.createElement("ul", { key }, block.items.map((item) => React.createElement("li", { key: item }, renderInline(item))));
  }
  if (block.type === "ol") {
    return React.createElement("ol", { key, start: block.start || undefined }, block.items.map((item) => React.createElement("li", { key: item }, renderInline(item))));
  }
  return React.createElement("p", { key }, renderInline(block.text));
}

function isHorizontalRule(line) {
  return /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line);
}

function isTableStart(lines, index) {
  return isTableRow(lines[index]) && isTableSeparator(lines[index + 1]);
}

function readTable(lines, start) {
  const headers = splitTableRow(lines[start]);
  const rows = [];
  let index = start + 2;
  while (isTableRow(lines[index])) {
    const cells = splitTableRow(lines[index]);
    rows.push(headers.map((_, cellIndex) => cells[cellIndex] || ""));
    index += 1;
  }
  return {
    consumed: index - start,
    block: { type: "table", headers, rows }
  };
}

function isTableRow(line = "") {
  return /^\s*\|.+\|\s*$/.test(line);
}

function isTableSeparator(line = "") {
  return /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
}

function splitTableRow(line) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

function renderInline(text) {
  const nodes = [];
  const pattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s)]+)|(\*\*[^*]+\*\*)|(`[^`]+`)/g;
  let cursor = 0;
  let match;
  while ((match = pattern.exec(text))) {
    if (match.index > cursor) nodes.push(text.slice(cursor, match.index));
    const value = match[0];
    if (match[2] || match[3]) {
      nodes.push(React.createElement("a", {
        key: `${match.index}-a`,
        href: match[2] || match[3],
        target: "_blank",
        rel: "noopener noreferrer"
      }, match[1] || value));
    } else if (match[4]) {
      nodes.push(React.createElement("strong", { key: `${match.index}-b` }, value.slice(2, -2)));
    } else {
      nodes.push(React.createElement("code", { key: `${match.index}-c` }, value.slice(1, -1)));
    }
    cursor = match.index + value.length;
  }
  if (cursor < text.length) nodes.push(text.slice(cursor));
  return nodes;
}
