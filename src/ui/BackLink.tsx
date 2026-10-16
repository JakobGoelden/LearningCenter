/** "Back" pill with a centred chevron, used at the top left of every page. */
export function BackLink({ href, label, class: cls = '' }: { href: string; label: string; class?: string }) {
  return (
    <a class={`back-link ${cls}`} href={href}>
      <span class="back-link-icon" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="14" height="14">
          <path d="M10 3 5 8l5 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </span>
      <span>{label}</span>
    </a>
  );
}
