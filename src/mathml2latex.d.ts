declare module "mathml2latex" {
    interface MathML2LaTeX {
        convert(mathml: string): string;
    }
    const mathml2latex: MathML2LaTeX;
    export default mathml2latex;
}
