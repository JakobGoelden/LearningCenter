import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'dashboard' }
  | { name: 'subject'; subject: string }
  | { name: 'sheet'; subject: string; sheet: string }
  | { name: 'topics'; subject: string }
  | { name: 'endless'; subject: string }
  /** `ahead`: review ahead, topics due by that date count as due. */
  | { name: 'quiz'; subject: string; ahead?: string }
  | { name: 'dojo'; subject: string; dojo?: string }
  | { name: 'study' }
  | { name: 'settings' }
  | { name: 'log' };

export function parseRoute(hash: string): Route {
  const [name, a, b] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  switch (name) {
    case 'subject':
    case 'topics':
    case 'endless':
      return a ? { name, subject: a } : { name: 'dashboard' };
    case 'quiz':
      return a ? { name, subject: a, ahead: /^\d{4}-\d{2}-\d{2}$/.test(b ?? '') ? b : undefined } : { name: 'dashboard' };
    case 'sheet':
      return a && b ? { name, subject: a, sheet: b } : { name: 'dashboard' };
    case 'dojo':
      return a ? { name, subject: a, dojo: b || undefined } : { name: 'dashboard' };
    case 'study':
    case 'settings':
    case 'log':
      return { name };
    default:
      return { name: 'dashboard' };
  }
}

export function href(route: Route): string {
  switch (route.name) {
    case 'dashboard':
      return '#/';
    case 'subject':
    case 'topics':
    case 'endless':
      return `#/${route.name}/${encodeURIComponent(route.subject)}`;
    case 'quiz':
      return `#/quiz/${encodeURIComponent(route.subject)}${route.ahead ? `/${route.ahead}` : ''}`;
    case 'sheet':
      return `#/sheet/${encodeURIComponent(route.subject)}/${encodeURIComponent(route.sheet)}`;
    case 'dojo':
      return `#/dojo/${encodeURIComponent(route.subject)}${route.dojo ? `/${encodeURIComponent(route.dojo)}` : ''}`;
    default:
      return `#/${route.name}`;
  }
}

export function navigate(route: Route) {
  location.hash = href(route);
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parseRoute(location.hash));
  useEffect(() => {
    const on = () => {
      setRoute(parseRoute(location.hash));
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}
