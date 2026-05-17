import { randomUUID } from 'node:crypto';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  devAutoApprove,
  createHarnessTracer,
  createHikariAgent,
  intentSnippetFromMessage,
  buildHarnessPlan,
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
const harness = createHarnessTracer(auditLog, { registry, auditLevel: 'basic' });

const baseCtx = {
  userId: 'user-alice',
  permissions: ['purchase'] as string[],
};

const runPrompt = async (userMessage: string): Promise<void> => {
  const traceId = randomUUID();
  const intent = intentSnippetFromMessage(userMessage);
  const contextRef = {
    current: { ...baseCtx, traceId, intent },
  };

  await harness.recordIntent({ traceId, userId: baseCtx.userId, intent });
  await harness.recordPlan({
    traceId,
    userId: baseCtx.userId,
    intent,
    plan: buildHarnessPlan(registry, {
      prefix: 'Answer using bookstore capabilities',
    }),
  });

  const agent = createHikariAgent(registry, engine, () => contextRef.current, {
    harness,
    systemPrompt: 'You are a helpful bookstore assistant. Use available tools to answer questions.',
  });

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

  console.log(`User: ${userMessage}\n`);
  await agent.prompt(userMessage);
  await agent.waitForIdle();
  agent.reset();
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
