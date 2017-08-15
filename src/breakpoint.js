/**
 * Class representing a breakpoint.
 */
class Breakpoint {
  /**
   * Create a breakpoint object.
   * Usually you don't need to create it yourself unless
   * you're doing some low-level stuff.
   *
   * @param {number} id The internal GDB ID of a breakpoint.
   * @param {object} [options] The options object.
   * @param {string} [options.file] The full path to a file in which breakpoint appears.
   * @param {number} [options.line] The line number at which the breakpoint appears.
   * @param {string|string[]} [options.func] The function in which the breakpoint appears
   *   or an array of functions (e.g. in case of templates).
   * @param {Thread} [options.thread] The thread for thread-specific breakpoints.
   */
  constructor (id, options = {}) {
    /**
     * The internal GDB ID of a breakpoint.
     *
     * @type {number}
     */
    this.id = id

    /**
     * The full path to a file in which breakpoint appears.
     *
     * @type {?string}
     */
    this.file = options.file || null

    /**
     * The line number at which the breakpoint appears.
     *
     * @type {?number}
     */
    this.line = options.line || null

    /**
     * The function in which the breakpoint appears
     * or an array of functions (e.g. in case of templates).
     *
     * @type {?string|string[]}
     */
    this.func = options.func || null

    /**
     * The thread for thread-specific breakpoints.
     *
     * @type {?Thread}
     */
    this.thread = options.thread || null
  }
}

export default Breakpoint
