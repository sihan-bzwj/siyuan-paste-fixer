"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/scenario.ts
var scenario_exports = {};
__export(scenario_exports, {
  DEFAULT_POLICY: () => DEFAULT_POLICY,
  countMathFormulas: () => countMathFormulas,
  detectPasteScenario: () => detectPasteScenario,
  looksLikeCode: () => looksLikeCode
});
module.exports = __toCommonJS(scenario_exports);

// src/fix-latex.ts
var MATH_SIGNALS_RE = /\$\$|\\\[|\\\]|\\\(|\\\)|\\begin\{|\\boxed\{|\\underbrace\{|\\frac\{|<math[\s>]|\\\\[a-zA-Z]|\\[_=^]/i;
function looksLikeMath(text) {
  return MATH_SIGNALS_RE.test(text) || (text.match(/\$/g) || []).length >= 2;
}

// src/mathml.ts
var import_mathml2latex = __toESM(require("mathml2latex"), 1);
function hasMathML(html) {
  return /<\/?(?:[a-z0-9]+:)?math[\s>]/i.test(html) || /class="katex|annotation\s+encoding|mjx-container|class="MathJax/i.test(html) || /<script[^>]*type=["']?math\/(?:tex|latex)/i.test(html);
}

// src/scenario.ts
var STRONG_LATEX_RE = /\\\[|\\\(|\\begin\{|\$\$|\\[a-zA-Z]{2,}/;
function looksLikeCode(text) {
  let score = 0;
  const t = text.slice(0, 4e3);
  if (/\[[a-zA-Z][\w-]*(?:[~^$*|]?=)\s*["'][^\]"']+["']\]/.test(t) || // [attr="v"]
  /<[a-zA-Z][\w-]*\b[^>]*["'][^>]*["'][^>]*>/.test(t) || // <tag a="v">
  /\.\w+\s*\[["'][^"']+["']\]/.test(t)) {
    score += 2;
  }
  if (/\{\s*"[^"]+"\s*:/.test(t) && t.includes("}")) {
    score += 2;
  }
  if (/[\w.#][\w.#:@>-]*\s*\{[^{}]*\}/.test(t)) {
    score += 2;
  }
  if (/#[0-9a-fA-F]{3,8}\b/.test(t) || /(?:\d+(?:\.\d+)?)(?:px|em|rem|vw|vh|%)\b/.test(t)) {
    score += 1;
  }
  if (/^\s*(const|let|var|function|class|import|export|def|return|if|else|for|while|switch|case|using|package|public|private|static)\b/m.test(t)) {
    score += 2;
  }
  if (/=>|===|!==|::|->/.test(t) || /;\s*$/.test(t)) {
    score += 1;
  }
  if (score < 1) {
    return false;
  }
  return !STRONG_LATEX_RE.test(t);
}
var DEFAULT_POLICY = {
  "siyuan-internal": "pass",
  "code-target": "pass",
  "code-content": "smart",
  // 智能=原样+提示（代码不参与公式修复）
  "web-math": "smart",
  "ai-latex": "smart",
  "mixed": "smart",
  "plain-prose": "pass"
};
function detectPasteScenario(input) {
  const { textPlain, textHTML, siyuanHTML, inCodeTarget } = input;
  if (siyuanHTML && /data-type="(?:NodeMathBlock|inline-math)"/.test(siyuanHTML)) {
    return "siyuan-internal";
  }
  if (inCodeTarget) {
    return "code-target";
  }
  if (hasMathML(textHTML)) {
    return "web-math";
  }
  if (looksLikeCode(textPlain)) {
    return "code-content";
  }
  if (!looksLikeMath(textPlain)) {
    return "plain-prose";
  }
  if (STRONG_LATEX_RE.test(textPlain)) {
    return "ai-latex";
  }
  return "mixed";
}
function countMathFormulas(markdown) {
  const blocks = (markdown.match(/\$\$[\s\S]+?\$\$/g) || []).length;
  const rest = markdown.replace(/\$\$[\s\S]+?\$\$/g, "");
  const inlines = (rest.match(/\$([^$\n]+?)\$/g) || []).length;
  return blocks + inlines;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  DEFAULT_POLICY,
  countMathFormulas,
  detectPasteScenario,
  looksLikeCode
});
