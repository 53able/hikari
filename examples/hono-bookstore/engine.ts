import {
  createApprovalApi,
  createAuditLog,
  createInMemoryApprovalStore,
  createInMemoryStorage,
  createEngine,
  devAutoApprove,
} from '../../src/index.js';
import type { ApprovalApi } from '../../src/core/approval-store.js';
import type { AuditLogger, AuditStorage } from '../../src/core/audit.js';
import type { Engine } from '../../src/core/execution.js';
import type { Registry } from '../../src/core/registry.js';
import { registry, runtime } from '../bookstore/registry.js';

/** 書店レジストリと開発用エンジン（監査・自動承認）を組み立てる。 */
export const createBookstoreEngine = (): {
  readonly registry: Registry;
  readonly engine: Engine;
  readonly auditLog: AuditLogger;
  readonly auditStorage: AuditStorage;
  readonly approvalApi: ApprovalApi;
} => {
  const auditStorage = createInMemoryStorage();
  const auditLog = createAuditLog(auditStorage);
  const approvalApi = createApprovalApi(createInMemoryApprovalStore());
  const engine = createEngine({
    registry,
    auditLog,
    approvalGate: devAutoApprove,
    runtime,
  });
  return { registry, engine, auditLog, auditStorage, approvalApi, runtime };
};
