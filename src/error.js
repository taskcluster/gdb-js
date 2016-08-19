/**
 * Class representing an internal GDB error.
 *
 * @extends Error
 */
class GDBError extends Error {
  /**
   * Create a GDBError.
   *
   * @param {string} cmd Command that led to this error.
   * @param {string} msg Error message.
   * @param {number} [code] Error code.
   *
   * @private
   */
  constructor (cmd, msg, code) {
    super(msg)

    this.name = 'GDBError'
    /**
     * Command that led to this error.
     *
     * @type {string}
     **/
    this.command = cmd
    /**
     * Error message.
     *
     * @type {string}
     **/
    this.message = msg
    /**
     * Error code.
     *
     * @type {?number}
     **/
    this.code = code
  }
}

export default GDBError
