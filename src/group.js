/**
 * Class representing a thread group (aka target, aka inferior).
 */
class ThreadGroup {
  /**
   * Create a thread group object.
   * Usually you don't need to create it yourself unless
   * you're doing some low-level stuff.
   *
   * @param {number} id The internal GDB ID of a thread group.
   * @param {object} [options] The options object.
   * @param {string} [options.executable] The executable of target.
   * @param {number} [options.pid] The PID of the thread-group.
   */
  constructor (id, options = {}) {
    /**
     * The internal GDB ID of a thread group.
     *
     * @type {number}
     */
    this.id = id

    /**
     * The executable of target.
     *
     * @type {?string}
     */
    this.executable = options.executable || null

    /**
     * The PID of the thread-group.
     *
     * @type {?number}
     */
    this.pid = Number.isInteger(options.pid)
      ? options.pid : null
  }
}

export default ThreadGroup
