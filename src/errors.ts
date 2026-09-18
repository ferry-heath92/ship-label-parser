export interface LabelSyntaxErrorInit {
  message: string
  line: number
  column: number
  lineText: string
  length: number
  sourceName?: string
}

/**
 * Raised whenever a label document can't be parsed. Carries enough
 * position information to point straight at the offending text instead
 * of making the caller re-read the whole document to find it.
 */
export class LabelSyntaxError extends Error {
  readonly line: number
  readonly column: number
  readonly lineText: string
  readonly length: number
  readonly sourceName: string

  constructor(init: LabelSyntaxErrorInit) {
    super(init.message)
    this.name = 'LabelSyntaxError'
    this.line = init.line
    this.column = init.column
    this.lineText = init.lineText
    // a length of 0 would draw no caret at all, which is more confusing
    // than pointing at a single character
    this.length = Math.max(init.length, 1)
    this.sourceName = init.sourceName ?? 'label'
  }

  /**
   * Renders a compiler-style pointer at the offending line and column,
   * e.g.:
   *
   *   error: unknown unit "lbs", expected one of "lb", "kg"
   *     --> label:9:11
   *      |
   *   9  |   weight: 2.5 lbs
   *      |           ^^^
   */
  toString(): string {
    const lineNumberText = String(this.line)
    const gutter = ' '.repeat(lineNumberText.length)
    const pointer = ' '.repeat(this.column - 1) + '^'.repeat(this.length)
    return [
      `error: ${this.message}`,
      `  --> ${this.sourceName}:${this.line}:${this.column}`,
      `${gutter} |`,
      `${lineNumberText} | ${this.lineText}`,
      `${gutter} | ${pointer}`,
    ].join('\n')
  }
}
