import { useEffect, useState } from 'preact/hooks';

export type Route =
  | { name: 'dashboard' }
  | { name: 'topics'; subject: string }
  | { name: 'quiz'; subject: string }
  | { name: 'dojo'; subject: string; dojo?: string }
  | { name: 'settings' }
  | { name: 'log' };

export function parseRoute(hash: string): Route {
  const [name, a, b] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  switch (name) {
    case 'topics':
    case 'quiz':
      return a ? { name, subject: a } : { name: 'dashboard' };
    case 'dojo':
      return a ? { name, subject: a, dojo: b || undefined } : { name: 'dashboard' };
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
    case 'topics':
    case 'quiz':
      return `#/${route.name}/${encodeURIComponent(route.subject)}`;
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
