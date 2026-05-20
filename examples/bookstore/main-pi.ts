import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  devAutoApprove,
} from '../../src/index.js';
import { loadPrompt } from '../../src/agent/load-prompt.js';
import { createHikariHarness } from '../../src/pi.js';
import {
  listBooks,
  getBook,
  purchaseBook,
  addBook,
  deleteBook,
  bookstoreRuntime,
} from './capabilities.js';

const registry = createRegistry()
  .register(listBooks)
  .register(getBook)
  .register(purchaseBook)
  .register(addBook)
  .register(deleteBook);

const storage = createInMemoryStorage();
const auditLog = createAuditLog(storage);

const { agent, runTurn } = createHikariHarness({
  registry,
  auditLog,
  approvalGate: devAutoApprove,
  runtime: bookstoreRuntime,
  planPrefix: 'Answer using bookstore capabilities',
  agentOptions: {
    systemPrompt: loadPrompt('bookstore-assistant'),
  },
});

const baseCtx = {
  userId: 'user-alice',
  permissions: ['purchase'] as string[],
};

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

const runPrompt = async (userMessage: string): Promise<void> => {
  console.log(`User: ${userMessage}\n`);
  const { traceId } = await runTurn({ message: userMessage, context: baseCtx });
  console.log(`\n(traceId: ${traceId})`);
};

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('  Hikari Bookstore — Pi Agent Example');
  console.log('═══════════════════════════════════════\n');

  await runPrompt('What books do you have in stock?');
  await runPrompt('Buy 1 copy of Clean Code for me.');

  console.log('\n--- Audit trail ---');
  const entries = storage.getAll();
  for (const entry of entries) {
    const ts = entry.timestamp.toISOString().slice(11, 23);
    console.log(`  [${ts}] ${entry.type.padEnd(24)} ${entry.capabilityName}`);
  }
  console.log(`\nTotal audit entries: ${entries.length}`);
}

run().catch(console.error);
