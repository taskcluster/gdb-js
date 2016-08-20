/**
 * Class representing a thread.
 */
class Thread {
  /**
   * Create a thread object.
   * Usually you don't need to create it yourself unless
   * you're doing some low-level stuff.
   *
   * @param {number} id The internal GDB ID of a thread.
   * @param {object} [options] The options object.
   * @param {string} [options.status] The thread status (e.g. `stopped`).
   * @param {ThreadGroup} [options.group] The thread group.
   * @param {Frame} [options.frame] The frame where thread is currently on.
   */
  constructor (id, options = {}) {
    /**
     * The internal GDB ID of a thread.
     *
     * @type {number}
     */
    this.id = id

    /**
     * The thread status (e.g. `stopped`).
     *
     * @type {?string}
     */
    this.status = options.status || null

    /**
     * The thread group.
     *
     * @type {?ThreadGroup}
     */
    this.group = options.group || null

    /**
     * The frame where thread is currently on.
     *
     * @type {?Frame}
     */
    this.frame = options.frame || null
  }
}

export default Thread
