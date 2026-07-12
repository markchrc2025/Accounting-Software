import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthProvider.jsx';
import {
  getSettings,
  listVouchers,
  listJournalEntries,
  listDisbursementReports,
  weeklyProjectionsApi,
} from '../lib/api.js';

// Mirror of the doc-type config used in ApprovalsPage — defines which API source
// and RAW API statuses make a document "pending" for a verifier or approver.
// Vouchers/journal speak lowercase enums; disbursements/projections keep the
// capitalized labels the portal always used.
const DOC_TYPE_CONFIG = {
  'Vouchers': {
    source:         'vouchers',
    verifierStatus: ['for_verification', 'pending'], // 'pending' kept for legacy docs
    approverStatus: 'for_approval',
    docFilter:      (d) => d.voucherType !== 'check',
  },
  'Check Voucher': {
    source:         'vouchers',
    verifierStatus: ['for_verification'],
    approverStatus: 'for_approval',
    docFilter:      (d) => d.voucherType === 'check',
  },
  'Disbursements': {
    source:         'disbursements',
    verifierStatus: ['For Verification'],
    approverStatus: 'For Approval',
    docFilter:      () => true,
  },
  'Weekly Projections': {
    source:         'projections',
    verifierStatus: ['Pending Review'],
    approverStatus: 'Pending Approval',
    docFilter:      () => true,
  },
  'Journal': {
    source:         'journal',
    verifierStatus: ['pending_review'],
    approverStatus: 'pending_approval',
    docFilter:      () => true,
  },
};

const SOURCE_FETCHERS = {
  vouchers:      () => listVouchers({ limit: 500 }),
  journal:       () => listJournalEntries({ limit: 500 }),
  disbursements: () => listDisbursementReports(),
  projections:   () => weeklyProjectionsApi.list(),
};

/**
 * Returns the number of documents currently pending action for the signed-in
 * user across all document types routed to them. Real-time listeners are gone
 * with Firestore — the count refreshes on mount and every 60 seconds.
 */
export function useApprovalCount() {
  const { session } = useAuth();
  const me = session?.user?.email?.toLowerCase() || '';
  const [count, setCount] = useState(0);

  useEffect(() => {
    if (!me) { setCount(0); return; }
    let cancelled = false;

    async function refresh() {
      try {
        const settings = await getSettings();
        const routes = settings?.approvalRouting?.routes ?? [];

        // Determine which doc types this user is a verifier/approver for
        const docTypeRoles = {};
        for (const docType of Object.keys(DOC_TYPE_CONFIG)) {
          const isVerifier = routes.some(r => r.documentType === docType && (r.verifierEmail || '').toLowerCase() === me);
          const isApprover = routes.some(r => r.documentType === docType && (r.approverEmail || '').toLowerCase() === me);
          if (isVerifier || isApprover) docTypeRoles[docType] = { isVerifier, isApprover };
        }

        // One list call per API source (Vouchers + Check Voucher share 'vouchers')
        const sources = [...new Set(Object.keys(docTypeRoles).map(t => DOC_TYPE_CONFIG[t].source))];
        if (sources.length === 0) {
          if (!cancelled) setCount(0);
          return;
        }

        const rowsBySource = {};
        await Promise.all(sources.map(async (src) => {
          rowsBySource[src] = await SOURCE_FETCHERS[src]().catch(() => []);
        }));
        if (cancelled) return;

        let total = 0;
        for (const [src, rows] of Object.entries(rowsBySource)) {
          for (const row of rows) {
            const matches = Object.entries(docTypeRoles).some(([docType, roles]) => {
              const cfg = DOC_TYPE_CONFIG[docType];
              if (cfg.source !== src || !cfg.docFilter(row)) return false;
              if (roles.isVerifier && cfg.verifierStatus.includes(row.status)) return true;
              if (roles.isApprover && row.status === cfg.approverStatus) return true;
              return false;
            });
            if (matches) total += 1;
          }
        }
        if (!cancelled) setCount(total);
      } catch {
        /* transient failure — keep the last known count */
      }
    }

    refresh();
    const timer = setInterval(refresh, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [me]);

  return count;
}
