import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  devAutoApprove,
  createHikariAgent,
} from '../../src/index.js';
import { listBooks, getBook, purchaseBook, addBook, deleteBook } from './capabilities.js';

const registry = createRegistry()
  .register(listBooks)
  .register(getBook)
  .register(purchaseBook)
  .register(addBook)
  .register(deleteBook);

const storage = createInMemoryStorage();
const auditLog = createAuditLog(storage);
const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });

const agent = createHikariAgent(
  registry,
  engine,
  { userId: 'user-alice', permissions: ['purchase'] },
  { systemPrompt: 'You are a helpful bookstore assistant. Use available tools to answer questions.' },
);

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  Hikari Bookstore — Pi Agent Example');
  console.log('═══════════════════════════════════════\n');

  agent.subscribe((event) => {
    if (event.type === 'tool_execution_start') {
      console.log(`  → calling ${event.toolName}(${JSON.stringify(event.args)})`);
    }
    if (event.type === 'tool_execution_end' && !event.isError) {
      console.log(`  ← ${event.toolName} done`);
    }
    if (event.type === 'message_end') {
      const msg = event.message as { role?: string; content?: { type: string; text: string }[] };
      if (msg.role === 'assistant') {
        const text = msg.content
          ?.filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join('');
        if (text) console.log('\nAssistant:', text);
      }
    }
  });

  console.log('User: What books do you have in stock?\n');
  await agent.prompt('What books do you have in stock?');
  await agent.waitForIdle();

  console.log('\nUser: Buy 1 copy of Clean Code for me.\n');
  await agent.prompt('Buy 1 copy of Clean Code for me.');
  await agent.waitForIdle();

  console.log('\n--- Audit trail ---');
  const entries = storage.getAll();
  for (const entry of entries) {
    const ts = entry.timestamp.toISOString().slice(11, 23);
    console.log(`  [${ts}] ${entry.type.padEnd(24)} ${entry.capabilityName}`);
  }
  console.log(`\nTotal audit entries: ${entries.length}`);
}

run().catch(console.error);
