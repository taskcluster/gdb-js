/**
 * Class representing a frame.
 */
class Frame {
  /**
   * Create a frame object.
   *
   * @param {object} options The options object.
   * @param {string} options.file The full path to a file.
   * @param {number} options.line The line number.
   * @param {string} [options.func] The func.
   * @param {number} [options.level] The level of stack frame.
   */
  constructor (options = {}) {
    /**
     * The full path to a file.
     *
     * @type {string}
     */
    this.file = options.file

    /**
     * The line number.
     *
     * @type {number}
     */
    this.line = options.line

    /**
     * The func.
     * @type {?string}
     */
    this.func = options.func

    /**
     * The level of stack frame.
     *
     * @type {?number}
     */
    this.level = Number.isInteger(options.level)
      ? options.level : null
  }
}

export default Frame
