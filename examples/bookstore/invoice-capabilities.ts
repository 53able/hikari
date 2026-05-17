import { z } from 'zod';
import { defineCapability, policy } from '../../src/index.js';

const InvoiceSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  amount: z.number(),
  dueDate: z.string(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue']),
});

type Invoice = z.infer<typeof InvoiceSchema>;

const customers = new Map<string, { id: string; name: string; email: string }>([
  ['c1', { id: 'c1', name: 'Acme Corp', email: 'billing@acme.example' }],
  ['c2', { id: 'c2', name: 'Globex', email: 'ap@globex.example' }],
]);

const invoices = new Map<string, Invoice>([
  [
    'inv-101',
    {
      id: 'inv-101',
      customerId: 'c1',
      customerName: 'Acme Corp',
      amount: 120_000,
      dueDate: '2025-12-01',
      status: 'overdue',
    },
  ],
  [
    'inv-102',
    {
      id: 'inv-102',
      customerId: 'c2',
      customerName: 'Globex',
      amount: 45_000,
      dueDate: '2026-01-15',
      status: 'sent',
    },
  ],
]);

const emailDrafts = new Map<string, { id: string; to: string; subject: string; body: string }>();

/** 記事 MVP: 未払い請求の検索 */
export const searchOverdueInvoices = defineCapability({
  name: 'invoice_search_overdue',
  description: 'List invoices that are overdue and unpaid',
  inputSchema: z.object({}),
  outputSchema: z.array(InvoiceSchema),
  policy: {
    requiredPermissions: ['accounting'],
    sideEffects: ['read'],
    auditLevel: 'basic',
  },
  async handler() {
    return Array.from(invoices.values()).filter((inv) => inv.status === 'overdue');
  },
});

/** 記事 MVP: 顧客連絡先の取得 */
export const getCustomerContact = defineCapability({
  name: 'customer_get_contact',
  description: 'Get billing contact email for a customer',
  inputSchema: z.object({ customerId: z.string() }),
  outputSchema: z.object({ customerId: z.string(), name: z.string(), email: z.string() }),
  policy: {
    requiredPermissions: ['accounting'],
    sideEffects: ['read'],
    auditLevel: 'basic',
  },
  async handler({ customerId }) {
    const customer = customers.get(customerId);
    if (!customer) throw new Error(`Customer '${customerId}' not found`);
    return {
      customerId: customer.id,
      name: customer.name,
      email: customer.email,
    };
  },
});

/** 記事 MVP: リマインドメール下書き */
export const composeReminderEmail = defineCapability({
  name: 'email_compose_reminder',
  description: 'Compose a payment reminder email draft for an overdue invoice',
  inputSchema: z.object({
    invoiceId: z.string(),
    tone: z.enum(['polite', 'firm']).default('polite'),
  }),
  outputSchema: z.object({
    draftId: z.string(),
    to: z.string(),
    subject: z.string(),
    body: z.string(),
  }),
  policy: {
    requiredPermissions: ['accounting'],
    sideEffects: ['write'],
    auditLevel: 'full',
  },
  async handler({ invoiceId, tone }) {
    const invoice = invoices.get(invoiceId);
    if (!invoice) throw new Error(`Invoice '${invoiceId}' not found`);
    const customer = customers.get(invoice.customerId);
    if (!customer) throw new Error(`Customer '${invoice.customerId}' not found`);

    const draftId = `draft-${Date.now()}`;
    const subject = `Payment reminder: Invoice ${invoice.id}`;
    const body =
      tone === 'firm'
        ? `Dear ${customer.name},\n\nInvoice ${invoice.id} for ¥${invoice.amount.toLocaleString()} was due on ${invoice.dueDate}. Please remit payment within 3 business days.\n`
        : `Dear ${customer.name},\n\nThis is a friendly reminder that invoice ${invoice.id} (¥${invoice.amount.toLocaleString()}) was due on ${invoice.dueDate}.\n`;

    const draft = { id: draftId, to: customer.email, subject, body };
    emailDrafts.set(draftId, draft);
    return { draftId, to: draft.to, subject: draft.subject, body: draft.body };
  },
});

/** 記事 MVP: 顧客へのメール送信（承認必須） */
export const sendReminderEmail = defineCapability({
  name: 'email_send_reminder',
  description: 'Send a composed reminder email to the customer. Requires human approval.',
  inputSchema: z.object({ draftId: z.string() }),
  outputSchema: z.object({ messageId: z.string(), sentAt: z.string() }),
  policy: {
    ...policy.role('accounting'),
    sideEffects: ['external', 'financial'],
    requiresApproval: true,
    auditLevel: 'full',
  },
  async handler({ draftId }) {
    const draft = emailDrafts.get(draftId);
    if (!draft) throw new Error(`Draft '${draftId}' not found`);
  // Deterministic runtime: no LLM — simulated provider call
    return {
      messageId: `msg-${Date.now()}`,
      sentAt: new Date().toISOString(),
    };
  },
});
