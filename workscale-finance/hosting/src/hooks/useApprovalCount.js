import { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot, doc } from 'firebase/firestore';
import { db, auth } from '../firebase.js';

// Mirror of the doc-type config used in ApprovalsPage — defines which Firestore
// collection and statuses make a document "pending" for a verifier or approver.
const DOC_TYPE_CONFIG = {
  'Vouchers': {
    collection:     'vouchers',
    verifierStatus: ['For Verification', 'Pending'],
    approverStatus: 'For Approval',
    docFilter:      (d) => d.voucherType !== 'CHECK',
  },
  'Check Voucher': {
    collection:     'vouchers',
    verifierStatus: 'For Verification',
    approverStatus: 'For Approval',
    docFilter:      (d) => d.voucherType === 'CHECK',
  },
  'Disbursements': {
    collection:     'disbursementReports',
    verifierStatus: 'For Verification',
    approverStatus: 'For Approval',
    docFilter:      () => true,
  },
  'Weekly Projections': {
    collection:     'weeklyProjections',
    verifierStatus: 'Pending Review',
    approverStatus: 'Pending Approval',
    docFilter:      () => true,
  },
  'Journal': {
    collection:     'journalEntries',
    verifierStatus: 'Pending Review',
    approverStatus: 'Pending Approval',
    docFilter:      () => true,
  },
};

/**
 * Returns the number of documents currently pending action for the signed-in
 * user across all document types routed to them. Updates in real-time.
 */
export function useApprovalCount() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const me = auth.currentUser?.email?.toLowerCase();
    if (!me) return;

    let docUnsubs = [];
    const cancelDocListeners = () => { docUnsubs.forEach(u => u()); docUnsubs = []; };

    const routingUnsub = onSnapshot(doc(db, 'settings', 'approvalRouting'), (snap) => {
      cancelDocListeners();

      const routes = snap.exists() ? (snap.data().routes ?? []) : [];

      // Determine which doc types this user is a verifier/approver for
      const docTypeRoles = {};
      for (const docType of Object.keys(DOC_TYPE_CONFIG)) {
        const isVerifier = routes.some(r => r.documentType === docType && (r.verifierEmail || '').toLowerCase() === me);
        const isApprover = routes.some(r => r.documentType === docType && (r.approverEmail || '').toLowerCase() === me);
        if (isVerifier || isApprover) docTypeRoles[docType] = { isVerifier, isApprover };
      }

      // Group doc types by Firestore collection (Vouchers + Check Voucher share 'vouchers')
      const collectionGroups = {};
      for (const docType of Object.keys(docTypeRoles)) {
        const colName = DOC_TYPE_CONFIG[docType].collection;
        if (!collectionGroups[colName]) collectionGroups[colName] = { docTypes: [] };
        collectionGroups[colName].docTypes.push(docType);
      }

      if (Object.keys(collectionGroups).length === 0) {
        setCount(0);
        return;
      }

      const countByCollection = {};

      for (const [colName, { docTypes }] of Object.entries(collectionGroups)) {
        // Collect all statuses this listener needs to watch
        const statusSet = new Set();
        for (const docType of docTypes) {
          const cfg   = DOC_TYPE_CONFIG[docType];
          const roles = docTypeRoles[docType];
          if (roles.isVerifier) [].concat(cfg.verifierStatus).forEach(s => statusSet.add(s));
          if (roles.isApprover) statusSet.add(cfg.approverStatus);
        }

        const q = query(collection(db, colName), where('status', 'in', [...statusSet]));

        const unsub = onSnapshot(q, (colSnap) => {
          const filtered = colSnap.docs.filter(d => {
            const data = d.data();
            return docTypes.some(docType => {
              const cfg   = DOC_TYPE_CONFIG[docType];
              const roles = docTypeRoles[docType];
              if (!cfg.docFilter(data)) return false;
              const verStatuses = [].concat(cfg.verifierStatus);
              if (roles.isVerifier && verStatuses.includes(data.status)) return true;
              if (roles.isApprover && data.status === cfg.approverStatus) return true;
              return false;
            });
          });

          countByCollection[colName] = filtered.length;
          const total = Object.values(countByCollection).reduce((a, b) => a + b, 0);
          setCount(total);
        });

        docUnsubs.push(unsub);
      }
    });

    return () => {
      routingUnsub();
      cancelDocListeners();
    };
  }, []);

  return count;
}
