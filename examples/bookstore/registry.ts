import { createRegistry } from '../../src/index.js';
import {
  listBooks,
  getBook,
  purchaseBook,
  addBook,
  deleteBook,
  bookstoreRuntime,
} from './capabilities.js';

export const runtime = bookstoreRuntime;

/** `hikari serve` / `dev-invoke --entry` 用の bookstore レジストリ。 */
export const registry = createRegistry()
  .register(listBooks)
  .register(getBook)
  .register(purchaseBook)
  .register(addBook)
  .register(deleteBook);
