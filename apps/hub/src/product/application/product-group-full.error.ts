import {
  ApplicationError,
  type ApplicationErrorKindType,
} from '../../shared/application/application.error.js';

export class ProductGroupFullError extends ApplicationError {
  readonly kind: ApplicationErrorKindType = 'forbidden';

  constructor(maxProducts: number) {
    super(`The group holds ${String(maxProducts)} products already, which is the most it may`);
  }
}
