/**
 * Class representing a variable.
 */
class Variable {
  /**
   * Create a variable object.
   * Usually you don't need to create it yourself.
   *
   * @param {object} options The options object.
   * @param {string} options.name The name of the variable.
   * @param {string} options.type The type of the variable.
   * @param {string} options.scope The scope of the variable.
   * @param {string} options.value The value of the variable.
   */
  constructor (options = {}) {
    /**
     * The name of the variable.
     *
     * @type {string}
     */
    this.name = options.name

    /**
     * The type of the variable.
     *
     * @type {string}
     */
    this.type = options.type

    /**
     * The scope of the variable.
     *
     * @type {string}
     */
    this.scope = options.scope

    /**
     * The value of the variable.
     *
     * @type {string}
     */
    this.value = options.value
  }
}

export default Variable
