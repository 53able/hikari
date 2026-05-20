/**
 * 実行: npm test -- tests/examples-bookstore-output.test.ts
 */
import { describe, it, expect } from 'vitest';
import { createBookstoreEngine } from '../examples/hono-bookstore/engine.js';

const baseOpts = {
  userId: 'output-test-user',
  permissions: ['admin', 'purchase'] as string[],
};

describe('examples/bookstore outputSchema integration', () => {
  const { engine } = createBookstoreEngine();

  it('list_books returns schema-valid output', async () => {
    const result = await engine.execute('list_books', {}, baseOpts);
    expect(result.success).toBe(true);
    expect(Array.isArray(result.output)).toBe(true);
  });

  it('get_book returns schema-valid output', async () => {
    const result = await engine.execute('get_book', { bookId: '1' }, baseOpts);
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({ id: '1', title: expect.any(String) });
  });

  it('purchase_book returns schema-valid output', async () => {
    const result = await engine.execute(
      'purchase_book',
      { bookId: '2', quantity: 1 },
      { ...baseOpts, idempotencyKey: 'output-test-purchase' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      orderId: expect.any(String),
      total: expect.any(Number),
      message: expect.any(String),
    });
  });

  it('add_book returns schema-valid output', async () => {
    const result = await engine.execute(
      'add_book',
      {
        title: 'Output Test Title',
        author: 'Output Test Author',
        price: 19.99,
        stock: 4,
      },
      { ...baseOpts, idempotencyKey: 'output-test-add' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toMatchObject({
      title: 'Output Test Title',
      author: 'Output Test Author',
    });
  });

  it('delete_book returns schema-valid output', async () => {
    const added = await engine.execute(
      'add_book',
      {
        title: 'To Delete',
        author: 'Author',
        price: 1,
        stock: 0,
      },
      { ...baseOpts, idempotencyKey: 'output-test-delete-seed' },
    );
    const bookId = (added.output as { id: string }).id;
    const result = await engine.execute(
      'delete_book',
      { bookId },
      { ...baseOpts, idempotencyKey: 'output-test-delete' },
    );
    expect(result.success).toBe(true);
    expect(result.output).toEqual({
      deleted: true,
      message: `Book '${bookId}' permanently removed`,
    });
  });

});
