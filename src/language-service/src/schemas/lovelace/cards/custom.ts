/**
 * Support for custom Lovelace cards.
 *
 * By catching all `custom:*` and allowing additional properties, this
 * schema will match any custom card.
 */
import { CardOptions } from "../types";


/**
 * @TJS-additionalProperties true
 */
export interface Schema extends CardOptions {
  /**
   * @TJS-pattern custom:(.*)$
   */
  type: string;
}
