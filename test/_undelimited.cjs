"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
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
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/undelimited.ts
var undelimited_exports = {};
__export(undelimited_exports, {
  convertUndelimitedLatex: () => convertUndelimitedLatex,
  needsUndelimitedDetection: () => needsUndelimitedDetection
});
module.exports = __toCommonJS(undelimited_exports);

// src/latex-commands.ts
var LATEX_COMMAND_NAMES = `
    AA AE Alpha And Bbb Bbbk Beta Big Bigg Biggl Biggm Biggr Bigl Bigm Bigr Box Bra Braket Bumpeq Cap Chi
    Colonapprox Coloneq Coloneqq Colonsim Complex Cup DOTSB DOTSI DOTSX Dagger Darr DeclareMathSymbol
    DeclareRobustCommand DeclareTextCommandDefault Delta Diamond Doteq Downarrow Epsilon Eqcolon Eqqcolon Eta
    Finv Game Gamma H HUGE Harr Huge Im Iota Join KaTeX Kappa Ket LARGE LaTeX Lambda Large Larr Leftarrow
    Leftrightarrow Let Letter Lleftarrow Longleftarrow Longleftrightarrow Longrightarrow Lrarr Lsh Mu N Nu O OE
    Omega Omicron Overrightarrow P Phi Pi Pr Psi R Rarr Re Reals Relbar Rho Rightarrow Rrightarrow Rsh S Set
    Sigma Subset Supset Tau TeX TextOrMath Theta Uarr Uparrow Updownarrow Upsilon Vdash Vert Vvdash Xi Z Zeta aa
    above abovefrac acute acwopencirclearrow advance ae alef alefsym aleph allowbreak alpha amalg angl angle
    angln approx approxcolon approxcoloncolon approxeq arccos arcctg arcsin arctan arctg arg argmax argmin
    arraycolsep arrayrulewidth arraystretch ast asymp atop atopfrac backepsilon backprime backsim backsimeq
    backslash bar barwedge baselineskip bcancel because begin begingroup beta beth between bf bgroup big bigcap
    bigcirc bigcup bigg biggl biggm biggr bigl bigm bigodot bigoplus bigotimes bigr bigsqcup bigstar
    bigtriangledown bigtriangleup biguplus bigvee bigwedge binom binrel blacklozenge blacksquare blacktriangle
    blacktriangledown blacktriangleleft blacktriangleright blue blueA blueB blueC blueD blueE bm bmod bold
    boldmath boldsymbol bot bowtie boxdot boxed boxminus boxplus boxtimes bra brace bracefrac brack brackfrac
    braket breve bull bullet bumpeq c cal cancel cap cdleft cdleftarrow cdlongequal cdot cdotp cdots cdparent
    cdright cdrightarrow ce centerdot cfrac ch char check checkmark chi choose circ circeq circlearrowleft
    circlearrowright circledR circledS circledast circledcirc circleddash clap clubs clubsuit cnums colon
    colonapprox coloncolon coloncolonapprox coloncolonequals coloncolonminus coloncolonsim coloneq coloneqq
    colonequals colonminus colonsim color colorbox complement cong coppa coprod copyright cos cosec cosh cot
    cotg coth cr crcr csc csname ctg cth cup curlyeqprec curlyeqsucc curlyvee curlywedge current curvearrowleft
    curvearrowright cwopencirclearrow d dArr dag dagger daleth darr dashleftarrow dashrightarrow dashv dbinom
    dblcolon ddag ddagger ddddot dddot ddot ddots def deg degree delta det df dfrac diagdown diagup diamond
    diamonds diamondsuit digamma dim displaystyle div divideontimes documentclass dot doteq doteqdot dotplus
    dots dotsb dotsc dotsi dotsm dotso dotsx doublebarwedge doublecap doublecup doublerulesep downarrow
    downdownarrows downharpoonleft downharpoonright dp edef egroup ell else emph empty emptyset end endcsname
    endgroup endsubarray enskip enspace epsilon eqcirc eqcolon eqqcolon eqsim eqslantgtr eqslantless equalscolon
    equalscoloncolon equiv errmessage eta eth ex exist exists exp expandafter extra extrap fallingdotseq fbox
    fcolorbox fi flat fontsize foo footnotesize forall frac frak frown futurelet gamma gcd gdef ge genfrac geq
    geqq geqslant gets gg ggg gggtr gimel global globalfuture globallet globallong gnapprox gneq gneqq gnsim
    goldA goldB goldC goldD goldE grave gray grayA grayB grayC grayD grayE grayF grayG grayH grayI green greenA
    greenB greenC greenD greenE gt gtrapprox gtrdot gtreqless gtreqqless gtrless gtrsim gvertneqq hArr harr hat
    hbar hbox hdashline hearts heartsuit hfil hline hlines hom hookleftarrow hookrightarrow hphantom href hskip
    hslash hspace ht html htmlClass htmlData htmlId htmlStyle huge hyperref i idotsint if iff ifmmode iiiint
    iiint iint image imageof imath impliedby implies in includegraphics inf infin infty injlim int intercal
    intop iota isin it j jmath jot kaBlue kaGreen kappa ker kern ket keybin lArr lBrace lVert lambda land lang
    langle large larr lbrace lbrack lceil ldotp ldots le leadsto left leftarrow leftarrowtail leftdasharrow
    leftharpoondown leftharpoonup leftleftarrows leftrightarrow leftrightarrows leftrightharpoons
    leftrightsquigarrow leftthreetimes leq leqq leqslant lessapprox lessdot lesseqgtr lesseqqgtr lessgtr lesssim
    let lfloor lg lgroup lhd lim liminf limits limsup lineskiplimit ll llap llbracket llcorner lll llless
    lmoustache ln lnapprox lneq lneqq lnot lnsim log long longleftarrow longleftrightarrow longmapsto
    longrightarrow looparrowleft looparrowright lor lower lozenge lparen lq lrArr lrarr lrcorner lt ltimes lvert
    lvertneqq m macro macroName maltese mapsto maroonA maroonB maroonC maroonD maroonE math mathbb mathbf
    mathbin mathcal mathchoice mathclap mathclose mathellipsis matheth mathfrak mathinner mathit mathllap
    mathminus mathnormal mathop mathopen mathord mathpalette mathpunct mathrel mathring mathrlap mathrm mathscr
    mathsf mathsfit mathsterling mathstrut mathtt mathyen max mb mbox mdots measuredangle medmuskip medspace
    message mho mid middle min mintA mintB mintC minuscolon minuscoloncolon minuso mkern mod models mp mskip mu
    multimap n nLeftarrow nLeftrightarrow nRightarrow nVDash nVdash nabla name natnums natural ncong ne nearrow
    neg negmedspace negthickspace negthinspace neq new newcommand newline newmcodes nexists nfss ngeq ngeqq
    ngeqslant ngtr nhttp ni nleftarrow nleftrightarrow nleq nleqq nleqslant nless nmid nobreak nobreakspace
    noexpand nolimits nomallineskiplimit nonscript nonumber normalfont normalsize not notag notin notni
    nparallel nprec npreccurlyeq npreceq nrightarrow nshortmid nshortparallel nsim nsubseteq nsubseteqq nsucc
    nsucccurlyeq nsucceq nsupseteq nsupseteqq ntriangleleft ntrianglelefteq ntriangleright ntrianglerighteq nu
    nvDash nvdash nwarrow o odot oe oiiint oiint oint omega omicron ominus ooalign openup operator operatorname
    operatornamewithlimits oplus orange ordinarycolon origof oslash otimes outer over overbrace overbracket
    overgroup overleftarrow overleftharpoon overleftrightarrow overline overlinesegment overrightarrow
    overrightharpoon overset owns p par parallel partial pdfpxdimen penalty perp phantom phase phi pi pink
    pitchfork plim plusmn pm pmb pmod pod pounds prec precapprox preccurlyeq preceq precnapprox precneqq
    precnsim precsim prime prod projlim propto providecommand psi purple purpleA purpleB purpleC purpleD purpleE
    qquad quad r rArr rBrace rVert raisebox rang rangle rarr ratio rbrace rbrack rceil real reals red redA redB
    redC redD redE relax relbar renewcommand restriction rfloor rgroup rhd rho right rightarrow rightarrowtail
    rightdasharrow rightdelim rightharpoondown rightharpoonup rightleftarrows rightleftharpoons rightrightarrows
    rightsquigarrow rightthreetimes risingdotseq rlap rm rmoustache row rparen rq rrbracket rtimes rule rvert s
    sbox sc scriptfont scriptscriptfont scriptscriptstyle scriptsize scriptstyle sdot searrow sec sect
    selectfont set setlength setminus sf sh sharp shortmid shortparallel show showlists showthe sigma sim
    simcolon simcoloncolon simeq simneqq sin sinh sixptsize skewchar sl small smallfrown smallint smallsetminus
    smallsmile smash smile sout space spades spadesuit sphericalangle sqcap sqcup sqrt sqsubset sqsubseteq
    sqsupset sqsupseteq square ss stackrel star start stop string strut strutbox sub subarray sube subset
    subseteq subseteqq subsetneq subsetneqq substack succ succapprox succcurlyeq succeq succnapprox succneqq
    succnsim succsim sum sup supe supset supseteq supseteqq supsetneq supsetneqq surd swarrow t tag tan tanh tau
    tbinom tealA tealB tealC tealD tealE text textasciicircum textasciitilde textbackslash textbar textbardbl
    textbf textbraceleft textbraceright textcircled textcolor textcopyright textdagger textdaggerdbl textdegree
    textdollar textellipsis textemdash textendash textfont textgreater textit textless textmd textnormal
    textquotedblleft textquotedblright textquoteleft textquoteright textregistered textrm textsf textsterling
    textstyle texttt textunderscore textup tfrac tg th the therefore theta thetasym thickapprox thickmuskip
    thicksim thickspace thinmuskip thinspace tilde times tiny tmspace to top totalheight triangle triangledown
    triangleleft trianglelefteq triangleq triangleright trianglerighteq tt tw twoheadleftarrow twoheadrightarrow
    u uAC uArr uD uDBFF uDC uDFFF uE uF uFF uFFFF uarr ue ulcorner underbar underbrace underbracket undergroup
    underleftarrow underleftrightarrow underline underlinesegment underrightarrow underset unlhd unrhd uparrow
    updownarrow upharpoonleft upharpoonright uplus upsilon upuparrows urcorner url usepackage utilde v vDash
    varDelta varGamma varLambda varOmega varPhi varPi varPsi varSigma varTheta varUpsilon varXi varcoppa
    varepsilon varinjlim varkappa varliminf varlimsup varnothing varphi varpi varprojlim varpropto varrho
    varsigma varsubsetneq varsubsetneqq varsupsetneq varsupsetneqq vartheta vartriangle vartriangleleft
    vartriangleright varvdots vbox vcentcolon vcenter vdash vdots vec vee veebar verb vert vphantom vrule vss
    wedge weierp whitespace widecheck widehat widetilde wp wr x xA xLeftarrow xLeftrightarrow xRightarrow
    xcancel xdef xhookleftarrow xhookrightarrow xi xleftarrow xleftequilibrium xleftharpoondown xleftharpoonup
    xleftrightarrow xleftrightharpoons xlongequal xmapsto xrightarrow xrightequilibrium xrightharpoondown
    xrightharpoonup xrightleftarrows xrightleftharpoons xtofrom xtwoheadleftarrow xtwoheadrightarrow yen z zeta
`;
var LATEX_COMMANDS = new Set(LATEX_COMMAND_NAMES.trim().split(/\s+/));

// src/fix-latex.ts
function startsHttpUrl(text, index) {
  const head = text.slice(index, index + 8).toLowerCase();
  return head.startsWith("http://") || head.startsWith("https://");
}
function findProtectedMarkdownRanges(text) {
  const ranges = [];
  let i = 0;
  let lineStart = 0;
  const prevLineBlank = () => {
    if (lineStart === 0) {
      return true;
    }
    const prevNl = lineStart - 1;
    const prevStart = text.lastIndexOf("\n", prevNl - 1) + 1;
    return text.slice(prevStart, prevNl).trim() === "";
  };
  while (i < text.length) {
    if (i === lineStart && prevLineBlank()) {
      let q = i;
      let eff = 0;
      while (text[q] === " ") {
        eff++;
        q++;
      }
      if (text[q] === "	") {
        eff += 4;
      }
      if (eff >= 4) {
        const start = i;
        let cursor = i;
        let end = text.length;
        while (cursor < text.length) {
          const lineEnd = text.indexOf("\n", cursor);
          const limit = lineEnd < 0 ? text.length : lineEnd;
          if (text.slice(cursor, limit).trim() === "") {
            cursor = lineEnd < 0 ? text.length : lineEnd + 1;
            continue;
          }
          let r = cursor;
          let eff2 = 0;
          while (text[r] === " ") {
            eff2++;
            r++;
          }
          if (text[r] === "	") {
            eff2 += 4;
          }
          if (eff2 >= 4) {
            cursor = lineEnd < 0 ? text.length : lineEnd + 1;
          } else {
            end = cursor;
            break;
          }
        }
        ranges.push({ start, end });
        i = end;
        lineStart = text.lastIndexOf("\n", i - 1) + 1;
        continue;
      }
    }
    const column = i - lineStart;
    if ((text[i] === "`" || text[i] === "~") && column <= 3 && text.slice(i - column, i).trim() === "") {
      const marker = text[i];
      let run = 1;
      while (text[i + run] === marker) run++;
      if (run >= 3) {
        const start = i - column;
        let cursor = text.indexOf("\n", i + run);
        if (cursor < 0) {
          ranges.push({ start, end: text.length });
          break;
        }
        cursor++;
        let end = text.length;
        while (cursor < text.length) {
          const lineEnd = text.indexOf("\n", cursor);
          const limit = lineEnd < 0 ? text.length : lineEnd;
          let p = cursor;
          let spaces = 0;
          while (spaces < 4 && text[p] === " ") {
            spaces++;
            p++;
          }
          let closeRun = 0;
          while (text[p + closeRun] === marker) closeRun++;
          if (spaces <= 3 && closeRun >= run && text.slice(p + closeRun, limit).trim() === "") {
            end = lineEnd < 0 ? text.length : lineEnd + 1;
            break;
          }
          cursor = lineEnd < 0 ? text.length : lineEnd + 1;
        }
        ranges.push({ start, end });
        i = end;
        lineStart = text.lastIndexOf("\n", i - 1) + 1;
        continue;
      }
    }
    if (text[i] === "`") {
      let run = 1;
      while (text[i + run] === "`") run++;
      let cursor = i + run;
      let close = -1;
      while (cursor < text.length) {
        const next = text.indexOf("`", cursor);
        if (next < 0) break;
        let closeRun = 1;
        while (text[next + closeRun] === "`") closeRun++;
        if (closeRun === run) {
          close = next + closeRun;
          break;
        }
        cursor = next + closeRun;
      }
      const end = close < 0 ? text.length : close;
      ranges.push({ start: i, end });
      i = end;
      lineStart = text.lastIndexOf("\n", i - 1) + 1;
      continue;
    }
    if (text[i] === "]" && text[i + 1] === "(") {
      let depth = 1;
      let cursor = i + 2;
      while (cursor < text.length && depth > 0) {
        if (text[cursor] === "\\") {
          cursor += 2;
          continue;
        }
        if (text[cursor] === "(") depth++;
        else if (text[cursor] === ")") depth--;
        cursor++;
      }
      if (depth === 0) {
        ranges.push({ start: i + 2, end: cursor - 1 });
        i = cursor;
        lineStart = text.lastIndexOf("\n", i - 1) + 1;
        continue;
      }
      ranges.push({ start: i + 2, end: text.length });
      break;
    }
    if (text[i] === "<" && startsHttpUrl(text, i + 1)) {
      const close = text.indexOf(">", i + 1);
      const end = close < 0 ? text.length : close + 1;
      ranges.push({ start: i, end });
      i = end;
      lineStart = text.lastIndexOf("\n", i - 1) + 1;
      continue;
    }
    if (startsHttpUrl(text, i)) {
      let end = i;
      while (end < text.length && !/[\s<>]/.test(text[end])) end++;
      ranges.push({ start: i, end });
      i = end;
      lineStart = text.lastIndexOf("\n", i - 1) + 1;
      continue;
    }
    if (text[i] === "\n") {
      lineStart = i + 1;
    }
    i++;
  }
  return ranges;
}
function splitMarkdownSegments(text) {
  const ranges = findProtectedMarkdownRanges(text);
  const segments = [];
  let last = 0;
  for (const range of ranges) {
    if (range.start < last) continue;
    if (range.start > last) {
      segments.push({ text: text.slice(last, range.start), protected: false });
    }
    segments.push({ text: text.slice(range.start, range.end), protected: true });
    last = range.end;
  }
  if (last < text.length) {
    segments.push({ text: text.slice(last), protected: false });
  }
  return segments;
}

// src/undelimited.ts
var MATH_PUNCT = "=+-*/<>,.;:!?'`|~&";
function matchCommand(text, i) {
  if (text[i] !== "\\") {
    return -1;
  }
  const m = /^\\([a-zA-Z]+)/.exec(text.slice(i));
  if (!m || !LATEX_COMMANDS.has(m[1])) {
    return -1;
  }
  return m[0].length;
}
function findBalanced(text, open, openCh, closeCh) {
  let depth = 0;
  let j = open;
  for (; j < text.length && j - open <= 500; j++) {
    const c = text[j];
    if (c === "\\") {
      j++;
      continue;
    }
    if (c === openCh) {
      depth++;
    } else if (c === closeCh) {
      depth--;
      if (depth === 0) {
        return j;
      }
    }
  }
  return -1;
}
function isMathTokenStart(text, k) {
  const c = text[k];
  if (c === "\\") {
    return matchCommand(text, k) > 0;
  }
  if (c === "^" || c === "_") {
    return true;
  }
  if (MATH_PUNCT.includes(c)) {
    return true;
  }
  if (/[0-9({[]/.test(c)) {
    return true;
  }
  if (/[A-Za-z]/.test(c) && !/[A-Za-z]/.test(text[k + 1] ?? "")) {
    return true;
  }
  return false;
}
function parseMathFragment(line, start) {
  let j = start;
  let strong = false;
  let lastEnd = -1;
  while (j < line.length) {
    const c = line[j];
    if (c === "\\") {
      const len = matchCommand(line, j);
      if (len < 0) {
        break;
      }
      strong = true;
      j += len;
      lastEnd = j;
      continue;
    }
    if (c === "^" || c === "_") {
      strong = true;
      j++;
      if (line[j] === "\\") {
        const len = matchCommand(line, j);
        if (len < 0) {
          break;
        }
        j += len;
      } else if (line[j] === "{") {
        const close = findBalanced(line, j, "{", "}");
        if (close < 0) {
          break;
        }
        j = close + 1;
      } else if (j < line.length && (/[A-Za-z0-9]/.test(line[j]) || MATH_PUNCT.includes(line[j]))) {
        j++;
      } else {
        break;
      }
      lastEnd = j;
      continue;
    }
    if (MATH_PUNCT.includes(c)) {
      j++;
      lastEnd = j;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") {
      const close = findBalanced(line, j, c, c === "(" ? ")" : c === "[" ? "}" : "]");
      if (close < 0) {
        break;
      }
      if (/[\\^_]/.test(line.slice(j, close + 1))) {
        strong = true;
      }
      j = close + 1;
      lastEnd = j;
      continue;
    }
    if (/[0-9]/.test(c)) {
      while (j < line.length && /[0-9.]/.test(line[j])) {
        j++;
      }
      lastEnd = j;
      continue;
    }
    if (/[A-Za-z]/.test(c)) {
      let k = j;
      while (k < line.length && /[A-Za-z]/.test(line[k])) {
        k++;
      }
      if (k - j === 1) {
        j = k;
        lastEnd = j;
        continue;
      }
      break;
    }
    if (/\s/.test(c)) {
      let k = j;
      while (k < line.length && /\s/.test(line[k])) {
        k++;
      }
      if (k < line.length && isMathTokenStart(line, k)) {
        j = k;
        continue;
      }
      break;
    }
    break;
  }
  if (lastEnd <= start || !strong) {
    return null;
  }
  return { end: lastEnd, strong };
}
function needsUndelimitedDetection(text) {
  let count = 0;
  for (const segment of splitMarkdownSegments(text)) {
    if (segment.protected) {
      continue;
    }
    const t = segment.text;
    let i = 0;
    while (i < t.length) {
      if (t[i] === "\\") {
        const len = matchCommand(t, i);
        if (len > 0) {
          count++;
          i += len;
          continue;
        }
      }
      if ((t[i] === "^" || t[i] === "_") && !/[\^_]/.test(t[i - 1] ?? "") && /[A-Za-z0-9{\\]/.test(t[i + 1] ?? "")) {
        count++;
        i++;
        continue;
      }
      i++;
    }
    if (count >= 2) {
      return true;
    }
  }
  return false;
}
function convertUndelimitedLatex(text) {
  return splitMarkdownSegments(text).map((segment) => segment.protected ? segment.text : convertLines(segment.text)).join("");
}
function convertLines(block) {
  return block.split("\n").map(convertLine).join("\n");
}
function convertLine(line) {
  let out = "";
  let i = 0;
  while (i < line.length) {
    if (/\s/.test(line[i])) {
      out += line[i];
      i++;
      continue;
    }
    const frag = parseMathFragment(line, i);
    if (frag) {
      out += "$" + line.slice(i, frag.end).trim() + "$";
      i = frag.end;
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  convertUndelimitedLatex,
  needsUndelimitedDetection
});
