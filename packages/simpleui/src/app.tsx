import { SimpleUiSession } from './simple-ui-session.js';

/** Stable public application shell; session orchestration lives in its owned composition. */
export function App(): React.JSX.Element {
  return <SimpleUiSession />;
}
