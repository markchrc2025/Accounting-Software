// StatusPill — compact rounded badge for transaction statuses
const STATUS_MAP = {
  pending:   { bg: '#FFF7ED', border: '#FED7AA', text: '#C2410C' },
  approved:  { bg: '#ECFEFF', border: '#A5F3FC', text: '#0E7490' },
  paid:      { bg: '#F0FDF4', border: '#BBF7D0', text: '#15803A' },
  posted:    { bg: '#F0FDF4', border: '#BBF7D0', text: '#15803A' },
  rejected:  { bg: '#FEF2F2', border: '#FECACA', text: '#DC2626' },
  void:      { bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B' },
  voided:    { bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B' },
  draft:     { bg: '#FEFCE8', border: '#FDE047', text: '#854D0E' },
  cancelled: { bg: '#F8FAFC', border: '#E2E8F0', text: '#64748B' },
};

export function StatusPill({ status = 'draft', className = '' }) {
  const key = (status || 'draft').toLowerCase().replace(/\s+/g, '-');
  const style = STATUS_MAP[key] || STATUS_MAP.draft;

  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold border ${className}`}
      style={{ background: style.bg, borderColor: style.border, color: style.text }}
    >
      {status}
    </span>
  );
}
