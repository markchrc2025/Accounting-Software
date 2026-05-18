// MoneyText — renders ₱{value} with proper formatting; respects privacy mode
import { usePrivacy } from '../../contexts/PrivacyContext.jsx';

const PHP = new Intl.NumberFormat('en-PH', {
  style: 'currency',
  currency: 'PHP',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export function MoneyText({ value, className = '' }) {
  const { isPrivate } = usePrivacy();

  if (isPrivate) {
    return <span className={className}>₱••••</span>;
  }

  return (
    <span className={className}>
      {PHP.format(value ?? 0)}
    </span>
  );
}
