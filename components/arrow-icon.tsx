/** A fixed vector arrow, independent of the device's emoji font. */
export function ArrowIcon({ direction = 'up-right', size = 16 }: {
  direction?: 'up-right' | 'down';
  size?: number;
}) {
  return (
    <svg
      className="arrow-icon"
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {direction === 'down'
        ? <path d="M12 4v16m-6-6 6 6 6-6" />
        : <path d="M6 18 18 6M6 6h12v12" />}
    </svg>
  );
}
