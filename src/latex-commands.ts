/**
 * KaTeX 已知命令名表（从 node_modules/katex/src 抽取，见 test/katex-commands.cjs 的覆盖校验）。
 *
 * 用途：判断命令名后面紧跟的字母是"命令名的一部分"（合法命令，如 \bigcup、
 * \leftrightarrow、\rightarrowtail）还是"被吞掉空格的下一个 token"
 * （如 \proptoe → \propto e、\langleP_t → \langle P_t）。
 * 表里少一个命令，就可能把合法命令误拆成两段，所以宁可多收不可少收；
 * 测试会用同一套抽取逻辑反向校验（缺一个就失败）。
 */
const LATEX_COMMAND_NAMES = `
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

export const LATEX_COMMANDS: ReadonlySet<string> = new Set(LATEX_COMMAND_NAMES.trim().split(/\s+/));
