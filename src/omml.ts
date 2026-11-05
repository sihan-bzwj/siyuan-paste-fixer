/**
 * Word/WPS 公式（Office MathML，OMML）→ LaTeX：
 * 剪贴板 HTML 里的 Word 公式是 <m:oMath>（行内）或 <m:oMathPara>（独立成行），
 * 内部用 <m:r><m:t> 承载文字、m:f / m:sSup / m:rad / m:nary / m:d 等描述结构。
 * 网页 MathML（<math>）由 mathml.ts 处理，本模块只负责 OMML。
 * 只依赖标准 DOM API：解析交给调用方，这里只做递归转换，未知结构降级为子内容拼接。
 */

// 便宜的探测：oMath / oMathPara，允许无前缀、任意大小写、自闭合
const OMML_PROBE = /<(?:[a-z0-9]+:)?oMath(?:Para)?[\s/>]/i;

export function hasOmmlMath(html: string): boolean {
    return OMML_PROBE.test(html);
}

/** 取 localName 并去掉命名空间前缀：HTML 解析把 <m:oMath> 变成 "m:omath"。 */
function localNameOf(el: Element): string {
    const raw = el.localName || el.nodeName || "";
    const colon = raw.indexOf(":");
    const name = colon >= 0 ? raw.slice(colon + 1) : raw;
    return name.toLowerCase();
}

export function isOmmlElement(el: Element): boolean {
    if (!el) {
        return false;
    }
    const name = localNameOf(el);
    return name === "omath" || name === "omathpara";
}

// m:t 里常见的 Word 符号（Word 直接写 Unicode 字符，不经命令）
const TEXT_SYMBOLS: Record<string, string> = {
    "\u2212": "-", "\u2013": "-", "\u00d7": "\\times ", "\u00b7": "\\cdot ",
    "\u22c5": "\\cdot ", "\u00f7": "\\div ", "\u00b1": "\\pm ", "\u2213": "\\mp ",
    "\u2264": "\\le ", "\u2265": "\\ge ", "\u2260": "\\ne ", "\u2248": "\\approx ",
    "\u2261": "\\equiv ", "\u221d": "\\propto ", "\u2192": "\\to ", "\u2190": "\\leftarrow ",
    "\u21d2": "\\Rightarrow ", "\u21d4": "\\Leftrightarrow ", "\u221e": "\\infty ",
    "\u2208": "\\in ", "\u2209": "\\notin ", "\u2282": "\\subset ", "\u2286": "\\subseteq ",
    "\u222a": "\\cup ", "\u2229": "\\cap ", "\u2205": "\\emptyset ",
    "\u2202": "\\partial ", "\u2207": "\\nabla ", "\u221a": "\\sqrt ",
    "\u2032": "'", "\u2033": "''",
};

/** 单个字符转义（仅在数学模式有意义的那批）。 */
function escapeChar(ch: string): string {
    switch (ch) {
        case "\\": return "\\backslash ";
        case "{": return "\\{";
        case "}": return "\\}";
        case "_": return "\\_";
        case "^": return "\\text{\\textasciicircum}";
        case "%": return "\\%";
        case "&": return "\\&";
        case "#": return "\\#";
        case "$": return "\\$";
        case "~": return "\\text{\\textasciitilde}";
        default: return ch;
    }
}

/** m:t 文本：转义特殊字符，连续空白折成一个 LaTeX 空格 \ 。 */
function escapeLatexText(text: string): string {
    let out = "";
    let pendingSpace = false;
    for (const ch of text) {
        if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r" || ch === "\u00a0") {
            pendingSpace = true;
            continue;
        }
        if (pendingSpace && out.length > 0) {
            out += "\\ ";
        }
        pendingSpace = false;
        out += TEXT_SYMBOLS[ch] || escapeChar(ch);
    }
    return out;
}

function childByLocalName(el: Element, name: string): Element | null {
    const wanted = name.toLowerCase();
    for (const child of Array.from(el.children)) {
        if (localNameOf(child) === wanted) {
            return child;
        }
    }
    return null;
}

function childrenByLocalName(el: Element, name: string): Element[] {
    const wanted = name.toLowerCase();
    const list: Element[] = [];
    for (const child of Array.from(el.children)) {
        if (localNameOf(child) === wanted) {
            list.push(child);
        }
    }
    return list;
}

/** 属性元素可能被 HTML 解析吞进兄弟节点（<m:x m:val="1"/> 不是自闭合），所以向下递归找。 */
function findDescendant(el: Element, name: string): Element | null {
    const wanted = name.toLowerCase();
    for (const child of Array.from(el.children)) {
        if (localNameOf(child) === wanted) {
            return child;
        }
        const found = findDescendant(child, name);
        if (found) {
            return found;
        }
    }
    return null;
}

function propertyElement(el: Element, name: string): Element | null {
    for (const child of Array.from(el.children)) {
        if (localNameOf(child).endsWith("pr")) {
            const found = findDescendant(child, name);
            if (found) {
                return found;
            }
        }
    }
    return null;
}

function valAttr(el: Element): string {
    const scoped = el.getAttribute("m:val");
    if (scoped !== null) {
        return scoped.trim();
    }
    const plain = el.getAttribute("val");
    return plain === null ? "" : plain.trim();
}

function propertyValue(el: Element, name: string): string {
    const prop = propertyElement(el, name);
    if (!prop) {
        return "";
    }
    return valAttr(prop);
}

function collectByLocalName(el: Element, wanted: string, out: Element[]): void {
    for (const child of Array.from(el.children)) {
        if (localNameOf(child) === wanted) {
            out.push(child);
        } else {
            collectByLocalName(child, wanted, out);
        }
    }
}

/**
 * 取内容槽（m:e / m:num / m:den / m:sup …）。
 * HTML 解析把 <m:deg/> 这种空槽当开始标签，后面的兄弟节点会被吞进它里面，
 * 所以直接子节点找不到时，再往子节点里找一层：被吞进来的那个其实才是本层的槽。
 */
function slot(el: Element, name: string): Element | null {
    const direct = childByLocalName(el, name);
    if (direct) {
        return direct;
    }
    const wanted = name.toLowerCase();
    for (const child of Array.from(el.children)) {
        const found = findDescendant(child, wanted);
        if (found) {
            return found;
        }
    }
    return null;
}

/** 同 slot，但要取多个（m:d 的多个 m:e、m:eqArr 的多行）。 */
function slots(el: Element, name: string): Element[] {
    const direct = childrenByLocalName(el, name);
    if (direct.length > 0) {
        return direct;
    }
    const wanted = name.toLowerCase();
    for (const child of Array.from(el.children)) {
        const found: Element[] = [];
        collectByLocalName(child, wanted, found);
        if (found.length > 0) {
            return found;
        }
    }
    return [];
}

function convertPart(el: Element, name: string): string {
    const part = slot(el, name);
    if (!part) {
        return "";
    }
    return convertChildren(part);
}

function isTrue(value: string): boolean {
    return value === "1" || value === "on" || value === "true";
}

function convertChildren(el: Element): string {
    let out = "";
    for (const child of Array.from(el.children)) {
        out += convertElement(child);
    }
    return out;
}

/** 取纯文字（m:func 的 fName 之类需要判函数名的地方用）。 */
function plainText(el: Element): string {
    let out = "";
    for (const child of Array.from(el.children)) {
        if (localNameOf(child) === "t") {
            out += child.textContent || "";
        } else {
            out += plainText(child);
        }
    }
    return out;
}

const FUNC_NAMES = new Set([
    "sin", "cos", "tan", "cot", "sec", "csc", "arcsin", "arccos", "arctan",
    "sinh", "cosh", "tanh", "coth", "log", "ln", "lg", "exp",
    "lim", "max", "min", "sup", "inf", "det", "dim", "ker", "deg", "gcd", "hom", "arg", "Pr",
]);

const LIMIT_OPERATORS = new Set(["\\lim", "\\max", "\\min", "\\sup", "\\inf", "\\det", "\\gcd", "\\Pr"]);

/** 函数名：已知的用 \sin，单字母原样，其余 \operatorname{} 包起来。 */
function functionName(raw: string): string {
    const text = raw.trim();
    if (!text) {
        return "";
    }
    if (FUNC_NAMES.has(text)) {
        return "\\" + text + " ";
    }
    if (/^[A-Za-z]$/.test(text)) {
        return text;
    }
    return "\\operatorname{" + text + "} ";
}

const NARY_CHARS: Record<string, string> = {
    "\u222b": "\\int", "\u222c": "\\iint", "\u222d": "\\iiint", "\u222e": "\\oint",
    "\u2211": "\\sum", "\u220f": "\\prod", "\u2210": "\\coprod",
    "\u22c3": "\\bigcup", "\u22c2": "\\bigcap", "\u22c1": "\\bigvee", "\u22c0": "\\bigwedge",
    "\u2a01": "\\bigoplus", "\u2a02": "\\bigotimes", "\u2a00": "\\bigodot",
    "\u2a04": "\\biguplus", "\u2a06": "\\bigsqcup",
};

const DELIM_CHARS: Record<string, string> = {
    "(": "(", ")": ")", "[": "[", "]": "]", "|": "|",
    "{": "\\{", "}": "\\}", "\u2016": "\\|", "\u2225": "\\|",
    "\u27e8": "\\langle", "\u27e9": "\\rangle", "\u2329": "\\langle", "\u232a": "\\rangle",
    "\u230a": "\\lfloor", "\u230b": "\\rfloor", "\u2308": "\\lceil", "\u2309": "\\rceil",
};

/** 定界符：没写属性用默认值；写了空值表示「不显示这一侧」。 */
function delimiterOf(el: Element, name: string, fallback: string): string {
    const prop = propertyElement(el, name);
    if (!prop) {
        return fallback;
    }
    const raw = valAttr(prop);
    if (!raw) {
        return ".";
    }
    return DELIM_CHARS[raw] || raw;
}

const ACCENT_CHARS: Record<string, string> = {
    "^": "\\hat", "\u0302": "\\hat", "~": "\\tilde", "\u0303": "\\tilde",
    "-": "\\bar", "\u0304": "\\bar", "\u00af": "\\bar",
    "\u0305": "\\overline", "\u2192": "\\vec", "\u20d7": "\\vec",
    "\u0307": "\\dot", "\u0308": "\\ddot", "\u0301": "\\acute",
    "\u0300": "\\grave", "\u030c": "\\check", "\u0306": "\\breve",
};

function operatorOf(latex: string): string {
    const text = latex.trim();
    if (FUNC_NAMES.has(text)) {
        return "\\" + text;
    }
    return text;
}

function convertFraction(el: Element): string {
    const num = convertPart(el, "num");
    const den = convertPart(el, "den");
    const type = propertyValue(el, "type");
    if (type === "noBar") {
        return "\\genfrac{}{}{0pt}{}{" + num + "}{" + den + "}";
    }
    if (type === "lin") {
        return "{" + num + "}/{" + den + "}";
    }
    return "\\frac{" + num + "}{" + den + "}";
}

function convertScripted(el: Element, sub: boolean, sup: boolean): string {
    let out = "{" + convertPart(el, "e") + "}";
    if (sub) {
        out += "_{" + convertPart(el, "sub") + "}";
    }
    if (sup) {
        out += "^{" + convertPart(el, "sup") + "}";
    }
    return out;
}

function convertRadical(el: Element): string {
    const degEl = slot(el, "deg");
    const bodyEl = slot(el, "e");
    const body = bodyEl ? convertChildren(bodyEl) : "";
    let deg = "";
    // 空 <m:deg/> 会把后面的 m:e 吞进来：此时 deg 里那个 e 是被开方数，不是次数
    if (degEl && !(bodyEl && degEl.contains(bodyEl))) {
        deg = convertChildren(degEl);
    }
    if (!deg || isTrue(propertyValue(el, "degHide"))) {
        return "\\sqrt{" + body + "}";
    }
    return "\\sqrt[" + deg + "]{" + body + "}";
}

function convertNary(el: Element): string {
    const chr = propertyValue(el, "chr");
    const op = NARY_CHARS[chr] || "\\int";
    const sub = convertPart(el, "sub");
    const sup = convertPart(el, "sup");
    let out = op;
    if (sub) {
        out += "_{" + sub + "}";
    }
    if (sup) {
        out += "^{" + sup + "}";
    }
    const body = convertPart(el, "e");
    return body ? out + " " + body : out;
}

function convertDelimiter(el: Element): string {
    const beg = delimiterOf(el, "begChr", "(");
    const end = delimiterOf(el, "endChr", ")");
    const sepProp = propertyElement(el, "sepChr");
    let sep = "|";
    if (sepProp) {
        sep = DELIM_CHARS[valAttr(sepProp)] || valAttr(sepProp);
    }
    const parts: string[] = [];
    for (const part of slots(el, "e")) {
        parts.push(convertChildren(part));
    }
    const joiner = sep ? " " + sep + " " : " ";
    return "\\left" + beg + parts.join(joiner) + "\\right" + end;
}

function convertFunction(el: Element): string {
    const nameEl = slot(el, "fName");
    const raw = nameEl ? plainText(nameEl) : "";
    const head = functionName(raw);
    const body = convertPart(el, "e");
    if (!head) {
        return body;
    }
    return head + body;
}

function convertAccent(el: Element): string {
    const chr = propertyValue(el, "chr") || "^";
    const cmd = ACCENT_CHARS[chr] || "\\hat";
    return cmd + "{" + convertPart(el, "e") + "}";
}

function convertBar(el: Element): string {
    const pos = propertyValue(el, "pos");
    const body = convertPart(el, "e");
    return (pos === "bot" ? "\\underline{" : "\\overline{") + body + "}";
}

function convertLimit(el: Element, upper: boolean): string {
    const base = convertPart(el, "e");
    const lim = convertPart(el, "lim");
    if (!lim) {
        return base;
    }
    const op = operatorOf(base);
    if (LIMIT_OPERATORS.has(op)) {
        return op + (upper ? "^{" : "_{") + lim + "}";
    }
    return (upper ? "\\overset{" : "\\underset{") + lim + "}{" + base + "}";
}

function convertMatrix(el: Element): string {
    const rows: string[] = [];
    for (const row of slots(el, "mr")) {
        const cells: string[] = [];
        for (const cell of slots(row, "e")) {
            cells.push(convertChildren(cell).trim());
        }
        rows.push(cells.join(" & "));
    }
    if (rows.length === 0) {
        const cells: string[] = [];
        for (const cell of slots(el, "e")) {
            cells.push(convertChildren(cell).trim());
        }
        if (cells.length === 0) {
            return "";
        }
        rows.push(cells.join(" & "));
    }
    return "\\begin{matrix} " + rows.join(" \\\\ ") + " \\end{matrix}";
}

function convertEquationArray(el: Element): string {
    const rows: string[] = [];
    for (const row of slots(el, "e")) {
        const line = convertChildren(row).trim();
        if (line) {
            rows.push(line);
        }
    }
    if (rows.length === 0) {
        return "";
    }
    return "\\begin{aligned} " + rows.join(" \\\\ ") + " \\end{aligned}";
}

function convertGroupChar(el: Element): string {
    const chr = propertyValue(el, "chr");
    const pos = propertyValue(el, "pos");
    const body = convertPart(el, "e");
    if (chr === "\u23de" || chr === "\u23e0" || chr === "^" || pos === "top") {
        return "\\overbrace{" + body + "}";
    }
    return "\\underbrace{" + body + "}";
}

function convertElement(el: Element): string {
    const name = localNameOf(el);
    if (name.endsWith("pr")) {
        return "";
    }
    switch (name) {
        case "t":
            return escapeLatexText(el.textContent || "");
        case "f":
            return convertFraction(el);
        case "ssup":
            return convertScripted(el, false, true);
        case "ssub":
            return convertScripted(el, true, false);
        case "ssubsup":
            return convertScripted(el, true, true);
        case "spre":
            return "{}_{" + convertPart(el, "sub") + "}^{" + convertPart(el, "sup") + "}" +
                "{" + convertPart(el, "e") + "}";
        case "rad":
            return convertRadical(el);
        case "nary":
            return convertNary(el);
        case "d":
            return convertDelimiter(el);
        case "func":
            return convertFunction(el);
        case "acc":
            return convertAccent(el);
        case "bar":
            return convertBar(el);
        case "limlow":
            return convertLimit(el, false);
        case "limupp":
            return convertLimit(el, true);
        case "m":
            return convertMatrix(el);
        case "eqarr":
            return convertEquationArray(el);
        case "box":
            return "\\boxed{" + convertPart(el, "e") + "}";
        case "borderbox":
            return "\\boxed{" + convertPart(el, "e") + "}";
        case "groupchr":
            return convertGroupChar(el);
        case "phant":
            return "\\phantom{" + convertPart(el, "e") + "}";
        default:
            return convertChildren(el);
    }
}

/**
 * OMML 元素 → LaTeX 主体（不含 $ 定界符）。
 * 不是 oMath/oMathPara、内容为空、或转换中出任何错都返回 null，绝不抛异常。
 */
export function convertOmmlElement(el: Element): string | null {
    if (!el || !isOmmlElement(el)) {
        return null;
    }
    try {
        const latex = convertElement(el).trim();
        return latex.length > 0 ? latex : null;
    } catch {
        return null;
    }
}
