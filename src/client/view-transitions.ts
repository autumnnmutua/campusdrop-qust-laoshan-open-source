/** Navigations run as View Transitions where the browser supports them and the visitor has not asked for less motion. */
export const viewTransitionsEnabled=typeof document!=='undefined'&&'startViewTransition' in document&&!(typeof window!=='undefined'&&window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);
/** A valid view-transition-name for a record id (UUIDs may start with a digit, which a CSS ident cannot). */
export const vtName=(kind:string,id:string)=>`${kind}-${id.replace(/[^a-zA-Z0-9_-]/g,'')}`;
