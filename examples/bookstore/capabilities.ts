import { z } from 'zod';
import { defineCapability } from '../../src/index.js';
import type { CapabilityRuntime } from '../../src/core/capability.js';

const BookSchema = z.object({
  id: z.string(),
  title: z.string(),
  author: z.string(),
  price: z.number(),
  stock: z.number(),
});

type Book = z.infer<typeof BookSchema>;

/** 書店サンプル用の決定論的ランタイム。`createEngine({ runtime })` に渡す。 */
export type BookstoreRuntime = CapabilityRuntime & {
  readonly books: Map<string, Book>;
};

// In-memory store (replace with real DB in production)
const books = new Map<string, Book>([
  ['1', { id: '1', title: 'Clean Code', author: 'Robert C. Martin', price: 29.99, stock: 5 }],
  ['2', { id: '2', title: 'The Pragmatic Programmer', author: 'David Thomas', price: 34.99, stock: 3 }],
  ['3', { id: '3', title: 'Design Patterns', author: 'GoF', price: 44.99, stock: 2 }],
]);

export const bookstoreRuntime: BookstoreRuntime = { books };

const bookStore = (runtime: CapabilityRuntime): Map<string, Book> =>
  (runtime as BookstoreRuntime).books;

export const listBooks = defineCapability({
  name: 'list_books',
  description: 'List all books in the inventory, optionally filtered by title or author',
  inputSchema: z.object({
    filter: z.string().optional().describe('Optional search term for title or author'),
  }),
  outputSchema: z.array(BookSchema),
  policy: {
    requiredPermissions: [],
    sideEffects: ['read'],
    auditLevel: 'basic',
  },
  async handler({ filter }, context) {
    const all = Array.from(bookStore(context.runtime).values());
    if (!filter) return all;
    const q = filter.toLowerCase();
    return all.filter(
      (b) => b.title.toLowerCase().includes(q) || b.author.toLowerCase().includes(q),
    );
  },
});

export const getBook = defineCapability({
  name: 'get_book',
  description: 'Get details for a specific book by its ID',
  inputSchema: z.object({ bookId: z.string() }),
  outputSchema: BookSchema,
  policy: {
    requiredPermissions: [],
    sideEffects: ['read'],
    auditLevel: 'basic',
  },
  async handler({ bookId }, context) {
    const book = bookStore(context.runtime).get(bookId);
    if (!book) throw new Error(`Book '${bookId}' not found`);
    return book;
  },
});

export const purchaseBook = defineCapability({
  name: 'purchase_book',
  description:
    'Purchase a book. This charges the user and decrements stock. Requires approval.',
  inputSchema: z.object({
    bookId: z.string(),
    quantity: z.number().int().positive().default(1),
  }),
  outputSchema: z.object({
    orderId: z.string(),
    total: z.number(),
    message: z.string(),
  }),
  policy: {
    requiredPermissions: ['purchase'],
    sideEffects: ['write', 'financial'],
    requiresApproval: true,
    auditLevel: 'full',
  },
  async handler({ bookId, quantity }, context) {
    const store = bookStore(context.runtime);
    const book = store.get(bookId);
    if (!book) throw new Error(`Book '${bookId}' not found`);
    if (book.stock < quantity) {
      throw new Error(`Insufficient stock: only ${book.stock} available`);
    }
    book.stock -= quantity;
    const total = book.price * quantity;
    return {
      orderId: `ORD-${Date.now()}`,
      total,
      message: `Purchased ${quantity}× "${book.title}" for $${total.toFixed(2)}`,
    };
  },
});

export const addBook = defineCapability({
  name: 'add_book',
  description: 'Add a new book to the inventory (requires admin permission)',
  inputSchema: z.object({
    title: z.string(),
    author: z.string(),
    price: z.number().positive(),
    stock: z.number().int().nonnegative(),
  }),
  outputSchema: BookSchema,
  policy: {
    requiredPermissions: ['admin'],
    sideEffects: ['write'],
    auditLevel: 'full',
  },
  async handler({ title, author, price, stock }, context) {
    const store = bookStore(context.runtime);
    const id = String(Date.now());
    const book: Book = { id, title, author, price, stock };
    store.set(id, book);
    return book;
  },
});

export const deleteBook = defineCapability({
  name: 'delete_book',
  description:
    'Permanently remove a book from the inventory. IRREVERSIBLE. Requires admin + approval.',
  inputSchema: z.object({ bookId: z.string() }),
  outputSchema: z.object({ deleted: z.boolean(), message: z.string() }),
  policy: {
    requiredPermissions: ['admin'],
    sideEffects: ['write', 'irreversible'],
    requiresApproval: true,
    auditLevel: 'full',
  },
  async handler({ bookId }, context) {
    const store = bookStore(context.runtime);
    if (!store.has(bookId)) throw new Error(`Book '${bookId}' not found`);
    store.delete(bookId);
    return { deleted: true, message: `Book '${bookId}' permanently removed` };
  },
});
