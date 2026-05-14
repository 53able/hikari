import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  devAutoApprove,
} from '../../src/index.js';
import { listBooks, getBook, purchaseBook, addBook, deleteBook } from './capabilities.js';

// --- Setup (factory functions, no `new`) ---
const registry = createRegistry()
  .register(listBooks)
  .register(getBook)
  .register(purchaseBook)
  .register(addBook)
  .register(deleteBook);

const storage = createInMemoryStorage();
const auditLog = createAuditLog(storage);
const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  Hikari Bookstore — AI-Native Example');
  console.log('═══════════════════════════════════════\n');

  console.log('Registered capabilities:');
  for (const name of registry.list()) {
    const cap = registry.get(name)!;
    console.log(`  • ${name.padEnd(16)} ${cap.description.slice(0, 60)}`);
  }
  console.log();

  // 1. List books (read-only, no approval needed)
  console.log('1. Listing all books…');
  const listResult = await engine.execute('list_books', {}, {
    userId: 'user-alice',
    permissions: [],
    intent: 'Show me all available books',
  });
  for (const b of listResult.output as { title: string; author: string; price: number; stock: number }[]) {
    console.log(`   [${b.title}] by ${b.author} — $${b.price} (stock: ${b.stock})`);
  }
  console.log();

  // 2. Filter by author
  console.log('2. Filtering by "David"…');
  const filteredResult = await engine.execute('list_books', { filter: 'David' }, {
    userId: 'user-alice',
    permissions: [],
  });
  console.log('  ', JSON.stringify(filteredResult.output));
  console.log();

  // 3. Purchase (financial → requires approval)
  console.log('3. Purchasing book ID=1 (financial op, requires approval)…');
  try {
    const purchase = await engine.execute('purchase_book', { bookId: '1', quantity: 2 }, {
      userId: 'user-alice',
      permissions: ['purchase'],
      intent: 'Buy 2 copies of Clean Code',
    });
    console.log('  ', purchase.output);
  } catch (err) {
    console.error('  Purchase failed:', err instanceof Error ? err.message : err);
  }
  console.log();

  // 4. Try without permission (should throw PolicyViolationError)
  console.log('4. Attempting delete without admin permission…');
  try {
    await engine.execute('delete_book', { bookId: '3' }, {
      userId: 'user-alice',
      permissions: [],
    });
  } catch (err) {
    console.log('  Expected error:', err instanceof Error ? err.message : err);
  }
  console.log();

  // 5. Audit trail
  console.log('5. Audit trail (full trace):');
  const entries = storage.getAll();
  for (const entry of entries) {
    const ts = entry.timestamp.toISOString().slice(11, 23);
    console.log(`  [${ts}] ${entry.type.padEnd(24)} ${entry.capabilityName}`);
  }
  console.log();
  console.log(`Total audit entries: ${entries.length}`);
}

run().catch(console.error);
