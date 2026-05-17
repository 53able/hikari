/**
 * Article MVP flow (Zenn capability-first design):
 * overdue invoices → compose reminder → approval → send → audit trace
 *
 * Run: npx tsx examples/bookstore/main-flow.ts
 */
import { randomUUID } from 'node:crypto';
import {
  createRegistry,
  createAuditLog,
  createInMemoryStorage,
  createEngine,
  createHarnessTracer,
  createTraceViewer,
  createCapabilityExplorer,
  devAutoApprove,
} from '../../src/index.js';
import {
  searchOverdueInvoices,
  getCustomerContact,
  composeReminderEmail,
  sendReminderEmail,
} from './invoice-capabilities.js';

const registry = createRegistry()
  .register(searchOverdueInvoices)
  .register(getCustomerContact)
  .register(composeReminderEmail)
  .register(sendReminderEmail);

const storage = createInMemoryStorage();
const auditLog = createAuditLog(storage);
const engine = createEngine({ registry, auditLog, approvalGate: devAutoApprove });
const harness = createHarnessTracer(auditLog);
const traces = createTraceViewer(storage);
const explorer = createCapabilityExplorer(registry);

const ctx = {
  userId: 'user-alice',
  permissions: ['accounting'],
};

const run = async (): Promise<void> => {
  const traceId = randomUUID();
  const intent =
    '未払い請求を確認して、必要ならリマインドメールの下書きを作り、承認後に送信してください';

  console.log('═══════════════════════════════════════');
  console.log('  Hikari — Invoice reminder MVP flow');
  console.log('═══════════════════════════════════════\n');

  console.log('Capability explorer (text):');
  console.log(explorer.formatText());
  console.log();

  await harness.recordIntent({ traceId, userId: ctx.userId, intent });
  await harness.recordPlan({
    traceId,
    userId: ctx.userId,
    intent,
    plan: 'search overdue → get contact → compose → approve → send',
  });

  console.log('1. Search overdue invoices…');
  await harness.recordToolSelected({
    traceId,
    userId: ctx.userId,
    capabilityName: 'invoice_search_overdue',
  });
  const overdue = await engine.execute('invoice_search_overdue', {}, {
    ...ctx,
    traceId,
    intent,
  });
  const first = (overdue.output as { id: string; customerId: string }[])[0];
  if (!first) throw new Error('No overdue invoices in fixture');
  console.log('   ', overdue.output);
  console.log();

  console.log('2. Get customer contact…');
  await harness.recordToolSelected({
    traceId,
    userId: ctx.userId,
    capabilityName: 'customer_get_contact',
    toolInput: { customerId: first.customerId },
  });
  const contact = await engine.execute(
    'customer_get_contact',
    { customerId: first.customerId },
    { ...ctx, traceId, intent },
  );
  console.log('   ', contact.output);
  console.log();

  console.log('3. Compose reminder email…');
  await harness.recordToolSelected({
    traceId,
    userId: ctx.userId,
    capabilityName: 'email_compose_reminder',
    toolInput: { invoiceId: first.id },
  });
  const draft = await engine.execute(
    'email_compose_reminder',
    { invoiceId: first.id, tone: 'polite' },
    { ...ctx, traceId, intent },
  );
  const draftId = (draft.output as { draftId: string }).draftId;
  console.log('   ', draft.output);
  console.log();

  console.log('4. Send email (approval gate)…');
  await harness.recordToolSelected({
    traceId,
    userId: ctx.userId,
    capabilityName: 'email_send_reminder',
    toolInput: { draftId },
  });
  const sent = await engine.execute(
    'email_send_reminder',
    { draftId },
    { ...ctx, traceId, intent },
  );
  console.log('   ', sent.output);
  console.log();

  const span = await traces.getTrace(traceId);
  if (span) {
    console.log('5. Trace (formatted):');
    console.log(traces.formatTrace(span));
  }

  console.log(`\nTotal audit entries: ${storage.getAll().length}`);
};

run().catch(console.error);
